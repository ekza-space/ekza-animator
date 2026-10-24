// The contract-driven clip operators (CHARACTER-CONTRACT-SPEC §8.7–§8.10; C2), registered with the target chunk:
//
// - `target.slot.create {character, slot, from: 'blank' | 'default' | 'library' | 'file', libraryClip?, params?,
//   fileName?, bytes?}` (one undo step): makes the slot's clip with the contract's settings — a blank clip (30 fps, the
//   window's target length), the game default's library copy, a library clip or an imported file — named by the slot,
//   then the slot, the loop flag, root motion in place, the contact at the target time and the other markers the slot
//   declares. It composes the shipped operators inside one transaction (`clip.new`, `library.useClip`,
//   `file.importAnimation`, then the `clip.setSettings` body).
// - `target.fix {character, slot, rule, marker?}` (one undo step): the one-tap fix of a slot issue — *Make loop*
//   (`clip.makeLoop` matchEnds, Loop on), *Set in place* (root motion), *Fit timing* (the keys, the range and the
//   markers scaled to the window's target length), *Set contact* / *Set <marker>* (at the slot's target time, within
//   its limit), *Use default* (the slot cleared).
// - `target.marker.set {clip, marker, frame}` (one undo step): moves or clears a marker (the timeline's ◆ drag).
// - `target.exportPackage {character, devZip?, fileName?}` (no undo, no document change): the OMOBA hero package —
//   `file.exportCharacter`'s pipeline with `profile: 'ekza/omoba-humanoid-v2', clips: 'target'` — saved as the `.vrm`,
//   or as the developer zip (the VRM staged for OMOBA, one VRMA per custom animation, the slot map). Errors block.
import { EkzaError, type Fps, type Frame } from '@ekza-studio/anim-core';
import { type CharacterId, type ClipId, type ClipRecord, makeVrmMeta } from '@ekza-studio/doc';
import {
  type AnimationSlotSpec,
  type ContractModel,
  type ContractSlotSpec,
  contractTarget,
  type ExportArtifact,
  type ExportRequest,
  type LintIssue,
  OMOBA_PACKAGE_PROFILE_ID,
  omobaDevZipFileName,
  omobaLicense,
  omobaSlug,
  packOmobaDevZip,
} from '@ekza-studio/io';
import { newRecordId } from '../../app/internals';
import { IDENTITY_CLIP_PARAMS } from '../../library/params';
import type { ApplyContext, EditorApp, OperatorAgentPolicy, OperatorContext, PollResult } from '../../types';
import { GLOBAL_SCOPE } from '../../types';
import { blockingLints } from '../../workflows/export';
import { runExportCharacter } from '../../workflows/exportCharacter';
import { sanitizeClipName, uniqueName } from '../../workflows/names';
import { pinnedModel } from '../../workflows/target/contracts';
import { CONTACT_MARKER, scaleClipMarkers, setClipMarker } from '../../workflows/target/markers';
import { packageManifestOf, packagePlan } from '../../workflows/target/package';
import { slotStatuses } from '../../workflows/target/service';
import { FIX_LABELS } from '../../workflows/target/status';
import { patchTarget, type TargetRecord, targetOf } from '../../workflows/target/table';
import type * as ClipBodyModule from './clipBodies';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';

const AGENT: OperatorAgentPolicy = {
  policy: 'denied',
  reason: 'Targets are set by the person; agent tools arrive later',
};
const CATEGORY = 'target';
const BLANK_FPS: Fps = { num: 30, den: 1 };
const MARKER = /^[a-z][a-z0-9_]{0,31}$/;
const FROM = ['blank', 'default', 'library', 'file'] as const;
type From = (typeof FROM)[number];

type ClipBodies = typeof ClipBodyModule;
const loadBodies = (): Promise<ClipBodies> => import('./clipBodies');
const fpsOf = (fps: Fps): number => fps.num / fps.den;

/** The bound target, its model and the slot's spec (an open animation slot), or why not. */
function boundSlot(
  app: EditorApp,
  character: unknown,
  slot: unknown,
): { target: TargetRecord; model: ContractModel; spec: ContractSlotSpec; anim: AnimationSlotSpec } | string {
  if (typeof character !== 'string' || app.store.get('characters', character as CharacterId) === undefined) {
    return 'The character does not exist';
  }
  const target = targetOf(app.store, character as CharacterId);
  if (target === undefined) return 'The character has no target';
  const model = pinnedModel(target);
  if (model instanceof EkzaError) return model.message;
  if (typeof slot !== 'string') return 'slot must be a slot id';
  const view = contractTarget(model, target.target);
  const spec = model.slots[slot];
  if (view === undefined || spec === undefined || !view.slots.includes(slot)) {
    return `'${slot}' is not a slot of ${view?.name ?? target.target}`;
  }
  if (spec.animation === null) return `${spec.label} takes an object, not a clip`;
  return { target, model, spec, anim: spec.animation };
}

/** The clip frame of a marker's target time (seconds after the start), never past its limit. */
export function markerTargetFrame(
  clip: Pick<ClipRecord, 'fps' | 'range'>,
  marker: { readonly maxSecs: number | null; readonly targetSecs: number | null },
): Frame {
  const fps = fpsOf(clip.fps);
  const target = marker.targetSecs ?? marker.maxSecs ?? 0;
  let frames = Math.round(target * fps);
  if (marker.maxSecs !== null) frames = Math.min(frames, Math.floor(marker.maxSecs * fps + 1e-9));
  return Math.min(Math.max(clip.range.start + Math.max(frames, 0), clip.range.start), clip.range.end);
}

/** Frames of a blank clip: the window's target length at `fps`, kept inside the window. */
export function blankFrames(anim: AnimationSlotSpec, fps: Fps): number {
  const rate = fpsOf(fps);
  let frames = Math.max(1, Math.round(anim.window.targetSecs * rate));
  if (frames / rate < anim.window.minSecs) frames = Math.ceil(anim.window.minSecs * rate);
  if (frames / rate > anim.window.maxSecs) frames = Math.floor(anim.window.maxSecs * rate);
  return Math.max(1, frames);
}

/** The contract's settings on a slot's new clip (§8.7), the slot moved off any other clip, markers at their targets. */
function applyContractSettings(
  ctx: ApplyContext,
  bodies: ClipBodies,
  character: CharacterId,
  slot: string,
  anim: AnimationSlotSpec,
  id: ClipId,
): void {
  const tx = ctx.tx;
  if (tx === null) throw new EkzaError('internal', 'target.slot.create runs in a transaction');
  for (const other of tx.query.clipsOfCharacter(character)) {
    if (other.id !== id && other.slot === slot && other.deleted === null) tx.patch('clips', other.id, { slot: null });
  }
  const clip = tx.get('clips', id);
  if (clip === undefined) throw new EkzaError('internal', 'The slot clip was not written');
  const contact = anim.markers[CONTACT_MARKER];
  bodies.clipSetSettings(ctx, {
    clip: id,
    slot,
    loop: anim.loop,
    ...(anim.inPlace ? { rootMotion: 'in-place' as const } : {}),
    ...(contact === undefined ? {} : { contact: markerTargetFrame(clip, contact) }),
  });
  const written = tx.get('clips', id) as ClipRecord;
  for (const [name, marker] of Object.entries(anim.markers)) {
    if (name !== CONTACT_MARKER) setClipMarker(tx, written, name, markerTargetFrame(written, marker));
  }
  const target = targetOf(tx, character);
  if (target !== undefined && slot in target.aliases) {
    const aliases = { ...target.aliases };
    delete aliases[slot];
    patchTarget(tx, character, { aliases });
  }
}

interface CreatePrepared {
  readonly bodies: ClipBodies;
  /** blank: the new clip id; others: the inner operator, its args and its prepared value. */
  readonly id: ClipId | null;
  readonly inner: { readonly op: string; readonly args: unknown; readonly prepared: unknown } | null;
}

const CREATE_LABEL: Readonly<Record<From, string>> = {
  blank: 'New Clip for',
  default: 'Start from Default for',
  library: 'Use Clip for',
  file: 'Import Clip for',
};

const slotCreate = defineOperator<'target.slot.create', CreatePrepared>({
  id: 'target.slot.create',
  label: 'Make Slot Clip',
  description:
    "Makes a slot's clip with the contract's settings (length, loop, in place, contact) from a blank clip, the game " +
    'default, a library clip or a file.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Make Slot Clip',
  poll({ app }, args) {
    if (!isRecord(args)) return fail('expects { character, slot, from }');
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const bound = boundSlot(app, raw['character'], raw['slot']);
    if (typeof bound === 'string') return fail(bound);
    if (!bound.spec.customizable) {
      return fail(
        bound.spec.customizableFrom === null
          ? `${bound.spec.label} takes no custom fill`
          : `${bound.spec.label} opens with contract ${bound.spec.customizableFrom}`,
      );
    }
    if (!(FROM as readonly unknown[]).includes(raw['from'])) return fail(`from is one of ${FROM.join(', ')}`);
    if (raw['from'] === 'library' && typeof raw['libraryClip'] !== 'string') return fail('libraryClip is a clip id');
    if (raw['from'] === 'file' && (!(raw['bytes'] instanceof Uint8Array) || typeof raw['fileName'] !== 'string')) {
      return fail('a file needs { fileName, bytes }');
    }
    if (raw['from'] === 'default' && bound.spec.default === null) return fail(`${bound.spec.label} has no default`);
    return pollEditable(app);
  },
  async prepare(ctx, args) {
    const { app } = ctx;
    const bound = boundSlot(app, args.character, args.slot);
    if (typeof bound === 'string') throw new EkzaError('unsupported', bound);
    const bodies = await loadBodies();
    if (args.from === 'blank') {
      const id = newRecordId(app, 'clip');
      await app.store.open(`clip:${id}`);
      return { bodies, id, inner: null };
    }
    let op: string;
    let inner: unknown;
    if (args.from === 'file') {
      op = 'file.importAnimation';
      inner = { name: args.fileName, bytes: args.bytes, character: args.character };
    } else {
      let clip = args.libraryClip ?? '';
      if (args.from === 'default') {
        const manifest = await app.library.service.manifest();
        clip = (bound.spec.default?.name ?? '').replaceAll('_', '-');
        if (!manifest.clips.some((entry) => entry.id === clip)) {
          throw new EkzaError('unsupported', `The game's default for ${bound.spec.label} is not in the clip library`);
        }
      }
      op = 'library.useClip';
      inner = {
        character: args.character,
        clip,
        slot: args.slot,
        ...(args.params !== undefined
          ? { params: args.params }
          : bound.anim.inPlace
            ? { params: { ...IDENTITY_CLIP_PARAMS, inPlace: true } }
            : {}),
      };
    }
    const def = app.operators.get(op);
    if (def === undefined) throw new EkzaError('unsupported', `${op} is not available`);
    const poll = def.poll?.(ctx, inner) ?? true;
    if (poll !== true) throw new EkzaError('unsupported', poll.reason);
    const prepared: unknown = await def.prepare?.(ctx, inner);
    return { bodies, id: null, inner: { op, args: inner, prepared } };
  },
  apply(ctx, args, prepared) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'target.slot.create runs in a transaction');
    const bound = boundSlot(app, args.character, args.slot);
    if (typeof bound === 'string') throw new EkzaError('unsupported', bound);
    const taken = tx.query.clipsOfCharacter(args.character).map((clip) => clip.name);
    const name = uniqueName(sanitizeClipName(bound.spec.label), taken);
    let id: ClipId;
    if (prepared.inner === null) {
      const frames = blankFrames(bound.anim, BLANK_FPS);
      ({ clip: id } = prepared.bodies.clipNew(
        ctx,
        { character: args.character, name, fps: BLANK_FPS, range: { start: 0, end: frames }, loop: bound.anim.loop },
        { id: prepared.id as ClipId },
      ));
    } else {
      const def = app.operators.get(prepared.inner.op);
      if (def === undefined) throw new EkzaError('unsupported', `${prepared.inner.op} is not available`);
      const result = def.apply(ctx, prepared.inner.args, prepared.inner.prepared) as {
        readonly clip?: ClipId;
        readonly clips?: readonly ClipId[];
      };
      const made = result.clip ?? result.clips?.[0];
      if (made === undefined) throw new EkzaError('unsupported', 'The file holds no clip for the character');
      id = made;
      if (tx.get('clips', id)?.name !== name) tx.patch('clips', id, { name });
    }
    applyContractSettings(ctx, prepared.bodies, args.character, args.slot, bound.anim, id);
    tx.annotate({ label: `${CREATE_LABEL[args.from]} ${bound.spec.label}` });
    return { clip: id };
  },
});

// ---------- fixes ----------

interface FixPrepared {
  readonly clip: ClipRecord;
  readonly loop: { readonly prepared: unknown; readonly args: unknown } | null;
}

/** The slot's clip (own or aliased) when the slot has an issue of `rule` (and `marker`), or why not. */
function fixTarget(
  app: EditorApp,
  args: { readonly character: CharacterId; readonly slot: string; readonly rule: string; readonly marker?: string },
): { clip: ClipRecord; anim: AnimationSlotSpec; label: string } | string {
  const bound = boundSlot(app, args.character, args.slot);
  if (typeof bound === 'string') return bound;
  const row = slotStatuses(app, args.character)?.rows.find((entry) => entry.slot === args.slot);
  const status = row?.status;
  if (status === undefined || (status.kind !== 'custom' && status.kind !== 'invalid')) {
    return `${bound.spec.label} has no clip to fix`;
  }
  // Fit timing applies to any filled slot (the contact fix's companion, §9 F2); the others need their issue.
  if (args.rule !== 'clip.duration') {
    const issue = status.issues.find(
      (entry) => entry.rule === args.rule && (args.marker === undefined || entry.marker === args.marker),
    );
    if (issue === undefined) return `${bound.spec.label} has no ${args.rule} issue`;
  }
  if (!(args.rule in FIX_LABELS)) return `No fix for ${args.rule}`;
  const clip = app.store.get('clips', status.clip);
  if (clip === undefined) return 'The clip does not exist';
  return { clip, anim: bound.anim, label: bound.spec.label };
}

/** Scales a clip's keys, range end, contact and markers about its start to `frames` long (Fit timing). */
function fitTiming(ctx: ApplyContext, clip: ClipRecord, frames: number): void {
  const tx = ctx.tx as NonNullable<ApplyContext['tx']>;
  const start = clip.range.start;
  const factor = frames / Math.max(clip.range.end - start, 1e-9);
  if (Math.abs(factor - 1) < 1e-9) return;
  for (const curve of tx.query.curvesOfClip(clip.id)) {
    for (const key of [...tx.query.keysOfCurve(curve.id), ...tx.query.hiddenKeys(curve.id)]) {
      tx.put('keys', {
        ...key,
        t: start + (key.t - start) * factor,
        inHandle: { dt: key.inHandle.dt * factor, dv: key.inHandle.dv },
        outHandle: { dt: key.outHandle.dt * factor, dv: key.outHandle.dv },
      });
    }
  }
  const range = { start, end: start + frames };
  const contact =
    clip.contact === null
      ? null
      : Math.min(Math.max(Math.round(start + (clip.contact - start) * factor), range.start), range.end);
  tx.patch('clips', clip.id, { range, contact });
  scaleClipMarkers(tx, clip, start, factor, range);
}

const fix = defineOperator<'target.fix', FixPrepared>({
  id: 'target.fix',
  label: 'Fix Slot',
  description:
    "Fixes a slot's clip for the contract: Make loop, Set in place, Fit timing, Set contact (or another marker), " +
    'Use default.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: (args) => FIX_LABELS[args.rule] ?? 'Fix Slot',
  poll({ app }, args) {
    if (!isRecord(args) || typeof args['rule'] !== 'string') return fail('expects { character, slot, rule }');
    if (args['marker'] !== undefined && (typeof args['marker'] !== 'string' || !MARKER.test(args['marker']))) {
      return fail('marker must be a marker name');
    }
    const found = fixTarget(app, args);
    return typeof found === 'string' ? fail(found) : pollEditable(app);
  },
  async prepare(ctx, args) {
    const found = fixTarget(ctx.app, args);
    if (typeof found === 'string') throw new EkzaError('unsupported', found);
    await ctx.app.store.open(`clip:${found.clip.id}`);
    if (args.rule !== 'clip.loop-closure' || ctx.app.store.query.curvesOfClip(found.clip.id).length === 0) {
      return { clip: found.clip, loop: null };
    }
    const def = ctx.app.operators.get('clip.makeLoop');
    const loopArgs = { clip: found.clip.id, method: 'matchEnds', rootTravel: found.anim.inPlace ? 'inPlace' : 'keep' };
    if (def === undefined || (def.poll?.(ctx, loopArgs) ?? true) !== true) return { clip: found.clip, loop: null };
    return { clip: found.clip, loop: { args: loopArgs, prepared: await def.prepare?.(ctx, loopArgs) } };
  },
  apply(ctx, args, prepared) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'target.fix runs in a transaction');
    const found = fixTarget(app, args);
    if (typeof found === 'string') throw new EkzaError('unsupported', found);
    const clip = tx.get('clips', found.clip.id) ?? found.clip;
    switch (args.rule) {
      case 'clip.loop-closure': {
        if (prepared.loop !== null) {
          app.operators.get('clip.makeLoop')?.apply(ctx, prepared.loop.args, prepared.loop.prepared);
        }
        if (tx.get('clips', clip.id)?.loop !== true) tx.patch('clips', clip.id, { loop: true });
        break;
      }
      case 'clip.in-place':
        tx.patch('clips', clip.id, { rootMotion: 'in-place' });
        break;
      case 'clip.duration':
        fitTiming(ctx, clip, blankFrames(found.anim, clip.fps));
        break;
      case 'clip.markers': {
        const name = args.marker ?? CONTACT_MARKER;
        const marker = found.anim.markers[name];
        if (marker === undefined) throw new EkzaError('unsupported', `${found.label} declares no ${name} marker`);
        setClipMarker(tx, clip, name, markerTargetFrame(clip, marker));
        break;
      }
      case 'slot.not-open': {
        if (clip.slot === args.slot) tx.patch('clips', clip.id, { slot: null });
        const target = targetOf(tx, args.character);
        if (target !== undefined && args.slot in target.aliases) {
          const aliases = { ...target.aliases };
          delete aliases[args.slot];
          patchTarget(tx, args.character, { aliases });
        }
        break;
      }
      default:
        throw new EkzaError('unsupported', `No fix for ${args.rule}`);
    }
    const what = args.rule === 'clip.markers' && args.marker !== undefined && args.marker !== CONTACT_MARKER;
    tx.annotate({
      label: `${what ? `Set ${String(args.marker).replace(/_/g, ' ')} marker` : FIX_LABELS[args.rule]} · ${found.label}`,
    });
  },
});

// ---------- markers ----------

const markerSet = defineOperator<'target.marker.set'>({
  id: 'target.marker.set',
  label: 'Set Marker',
  description: 'Moves a clip marker (contact, release, fire, footsteps, land) to a frame, or clears it.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: (args) => (args.marker === CONTACT_MARKER ? 'Set Contact' : 'Set Marker'),
  poll({ app }, args) {
    if (!isRecord(args) || typeof args['clip'] !== 'string') return fail('expects { clip, marker, frame }');
    const clip = app.store.get('clips', args['clip']);
    if (clip === undefined) return fail('The clip does not exist');
    if (typeof args['marker'] !== 'string' || !MARKER.test(args['marker'])) return fail('marker must be a marker name');
    const frame = args['frame'];
    if (frame !== null && (typeof frame !== 'number' || !Number.isFinite(frame))) {
      return fail('frame must be a frame or null');
    }
    if (typeof frame === 'number' && (frame < clip.range.start || frame > clip.range.end)) {
      return fail('The marker must lie inside the clip range');
    }
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'target.marker.set runs in a transaction');
    const clip = tx.get('clips', args.clip);
    if (clip === undefined) throw new EkzaError('invalid-record', 'The clip does not exist');
    setClipMarker(tx, clip, args.marker, args.frame === null ? null : Math.round(args.frame));
    tx.annotate({
      label: args.marker === CONTACT_MARKER ? 'Set Contact' : `Set ${args.marker.replace(/_/g, ' ')} marker`,
    });
  },
});

// ---------- the package ----------

/** The character export request of the OMOBA hero package (§8.10). */
export function packageRequest(character: CharacterId, fileName: string) {
  return {
    character,
    fileName,
    format: 'vrm' as const,
    profile: OMOBA_PACKAGE_PROFILE_ID,
    clips: 'target' as const,
    includeProps: null,
    material: null,
    thumbnail: 'stored' as const,
    validate: true,
  };
}

interface PackagePrepared {
  readonly artifact: ExportArtifact;
  readonly fileName: string;
  readonly bytes: Uint8Array | null;
  readonly mime: string;
  readonly lints: readonly LintIssue[];
}

/** The package VRM, or the developer zip around it (§4.2): no download, no document change. */
export async function buildPackage(
  app: EditorApp,
  character: CharacterId,
  opts: { readonly devZip?: boolean; readonly fileName?: string } = {},
): Promise<PackagePrepared> {
  const record = app.store.get('characters', character);
  if (record === undefined) throw new EkzaError('unsupported', 'The character does not exist');
  const meta = record.vrm ?? makeVrmMeta(record.name);
  const base = (opts.fileName ?? '').trim().replace(/\.(vrm|glb|zip)$/i, '') || omobaSlug(meta.name || record.name);
  const artifact = await runExportCharacter(app, packageRequest(character, base));
  const blocked = blockingLints(artifact).length > 0;
  if (opts.devZip !== true) {
    return {
      artifact,
      fileName: artifact.fileName,
      bytes: blocked ? null : artifact.bytes,
      mime: artifact.mime,
      lints: artifact.lints,
    };
  }
  const plan = packagePlan(app, character);
  const vrma = app.exporters.get('vrma');
  const animations: { slot: string; bytes: Uint8Array }[] = [];
  const lints: LintIssue[] = [...artifact.lints];
  if (!blocked && vrma !== undefined) {
    for (const clip of plan.clips) {
      const request: ExportRequest = {
        kind: 'vrma',
        character,
        clips: [clip.id],
        fileNamePattern: '{clip}',
        closeLoop: clip.loop,
        includeConstantTracks: true,
        acknowledgeLicense: false,
        profile: null,
        reduce: null,
      };
      const [out] = await vrma.run(app, request);
      if (out === undefined) continue;
      lints.push(...out.lints.filter((lint) => lint.severity === 'error'));
      animations.push({ slot: clip.slot ?? clip.name, bytes: out.bytes });
    }
  }
  const authors = meta.authors.filter((author) => author.trim() !== '');
  const kit = { displayName: meta.name || record.name, authors, license: omobaLicense(meta.licensePreset), slug: base };
  const thumbnail = meta.thumbnail === null ? null : await app.services.assets.get(meta.thumbnail).catch(() => null);
  const failed = lints.some((lint) => lint.severity === 'error');
  return {
    artifact,
    fileName: omobaDevZipFileName(kit),
    bytes: failed
      ? null
      : packOmobaDevZip({
          vrm: artifact.bytes,
          manifest: packageManifestOf(plan, '0'),
          animations,
          thumbnail,
          meta: kit,
        }),
    mime: 'application/zip',
    lints,
  };
}

/** The busy label of a running package export. */
export const PACKAGE_BUSY = 'Exporting the OMOBA package…';

const exportPackage = defineOperator<'target.exportPackage', PackagePrepared>({
  id: 'target.exportPackage',
  label: 'Export OMOBA Package',
  description:
    'Saves the OMOBA hero package: one VRM 1.0 with your slot animations and the slot map, or the developer zip.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  agent: AGENT,
  poll({ app }, args): PollResult {
    if (!isRecord(args) || typeof args['character'] !== 'string') return fail('expects { character, devZip? }');
    if (targetOf(app.store, args['character']) === undefined) {
      return fail('Set what the character is for first (Windows › Target)');
    }
    return OK;
  },
  async prepare({ app }: OperatorContext, args) {
    app.session.setState({ busy: { label: PACKAGE_BUSY, progress: null } });
    try {
      return await buildPackage(app, args.character, {
        ...(args.devZip === undefined ? {} : { devZip: args.devZip }),
        ...(args.fileName === undefined ? {} : { fileName: args.fileName }),
      });
    } finally {
      if (app.session.getState().busy?.label === PACKAGE_BUSY) app.session.setState({ busy: null });
    }
  },
  apply({ app }, _args, prepared) {
    const { fileName, bytes, mime, lints, artifact } = prepared;
    const errors = lints.filter((lint) => lint.severity === 'error');
    if (bytes === null) {
      app.services.notify.toast({
        kind: 'error',
        text: `${fileName} was not saved: ${errors[0]?.message ?? 'export check failed'}${
          errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
        }`,
      });
      return { fileName, saved: false, artifact, lints, bytes: null };
    }
    app.services.files.download(fileName, bytes, mime);
    const warnings = lints.filter((lint) => lint.severity === 'warning').length;
    app.services.notify.toast({
      kind: warnings > 0 ? 'warning' : 'success',
      text: `Exported ${fileName}${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`,
    });
    return { fileName, saved: true, artifact, lints, bytes };
  },
});

export const TARGET_SETUP_OPERATORS: readonly AnyOperator[] = [slotCreate, fix, markerSet, exportPackage];
