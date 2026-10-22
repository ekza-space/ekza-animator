# Auto-Rig: from a GLB to an OMOBA-ready VRM in minutes

Auto-Rig is Ekza Studio's simple mode: five steps from a static humanoid model to a rigged, animated VRM 1.0 for
OMOBA and Ekza Space. It runs entirely in your browser — your files are never uploaded — and it uses exactly the same
tools as the full Studio, so you can switch to Studio at any point and keep working on the same document.

Open [studio.ekza.io](https://studio.ekza.io) and choose **Start Auto-Rig** (tick *Remember my choice* to go straight
there next time; `/?chooser=1` shows the choice again). The address `/autorig` opens it directly.

## What you need

- A **humanoid model as GLB** (or glTF in a GLB) — one body standing on two legs, arms out to the sides (**T-pose**) or
  hanging down at an angle (**A-pose**). A VRM you already have is welcome too: it skips straight to animations.
- Up to 200,000 triangles (the wizard refuses heavier models and tells you how to reduce them in Blender; over
  60,000 it warns and asks once, and rigging takes longer).
- Desktop or tablet. On a phone everything works except weight painting.

FBX and OBJ are not read yet: in Blender use *File › Export › glTF 2.0 (.glb)*.

## ① Model

Drop the file on the page (or *Choose file…*, or try a sample). The report checks the model: **centred, on the
ground, facing +Z, upright, a human size**, and its pose (T or A). Each failed check has a one-click fix, each one
undo step: *Center and ground* (it also brings a model that sits far away back to the middle), *Face forward*,
*Stand up*, *Set height*; they move the whole model, ticked parts or not. If the file has several meshes (a low-poly
character is often 30 parts or more), every part that touches the body — directly or through other parts: hands on
forearms, shoes on ankles, eyes on the face — is part of the character; things that look separate (a sword on the
floor) are left out. An unticked part is hidden and marked *Left out*, so unticking one shows which mesh it is;
*Tick all* takes every part. If the report says *Arms not found*, Auto-Rig needs the arms held out to the sides
(T-pose or A-pose).

## ② Markers

Nine markers — head top, chin, pelvis, shoulder, elbow, wrist, knee, ankle, toe — are guessed from the silhouette.
**Drag in the front view to move a marker sideways and up, in the side view to set its depth** (a drag never changes
the axis that view does not show); the left side mirrors the right. Pick a marker in the list to grab it where markers
overlap; the arrow keys nudge the selected marker by 1 cm (with Shift by 1 mm). Choose how many finger joints you
want (none, thumb + 1, full hands). `G` guesses again. When the guess cannot find the arms (arms hanging straight
down, or not a person), **Auto-rig** waits until you have placed the Shoulder, Elbow and Wrist markers on the arm.

## ③ Rig

Press **Auto-rig**: the skeleton is created, the mesh is skinned automatically, and — for an A-posed model — the pose
is straightened to the VRM T-pose. The character starts moving at once (Walk; try Sword or Dance). Each part is its
own undo step, so `Ctrl/⌘+Z` shows exactly what each did.

If something looks wrong:

- **Adjust joints**: front, side and 3D views with the joints; drag a joint (`W`; `D`+`W` moves it alone). *Done*
  turns each hand with its forearm when you moved an elbow or a wrist (so an elbow moved back onto the arm line
  clears the T-pose check) and rebinds the skin.
- **Paint weights**: the brush from Studio (Replace, Add, Smooth; mirror on). Painting needs a larger screen than a
  phone.
- The checks list names any problem with its fix — e.g. an arm that is off its T-pose line, or arm or leg bones that
  move no part of the model (the skeleton is not inside the body: *Place the markers again*). `Esc` stops the motion
  test; one click on its button starts it again.

## ④ Animations

Search the CC0 library (Quaternius' Universal Animation Library: idle, walk, run, attacks, dance, jumps…), click a
card to see it on your character, set **Speed**, **Trim**, **Mirror**, **In place** and **Arm space** (lifts or lowers
the arms for bulky bodies), then **Add to character**. Add as many as you like; ✎ edits one, ✕ removes it. A card
marked *no slot* (Jog, Punch, Pistol shoot, Jump loop, Jump land) has no OMOBA slot: give it one under its name after
adding it, or it stays out of the VRM. You can also drop your own `.vrma` files here. Animations are optional: OMOBA
plays its own motion library on any VRM. The rig's controls stay hidden on steps ②–⑤; Studio shows them.

## ⑤ Export

- **Ekza avatar · VRM 1.0** (recommended): for OMOBA and Ekza Space. Fill in the author and choose a licence; a
  thumbnail is rendered for you. The checklist must be all ✓ before *Download* — it includes OMOBA's own runtime rules,
  and "T-pose rest". The VRM keeps one animation per OMOBA slot (idle, walk, attack…): an animation without a slot is
  listed under *Not in the VRM* with a button that gives it a free slot (the GLB and VRMA keep every animation). A VRM
  0.x you brought stays a VRM 0.x, which OMOBA accepts.
- **GLB with animations**, **Animations as VRMA**, and under *For developers* the **OMOBA local test kit** (the VRM, its
  thumbnail when it has one and a roster entry for OMOBA's local avatar manifest, with a README that names the VRM
  version).

To use your avatar in OMOBA online, upload the VRM to Ekza Hub ([characters-to-ekza.md](characters-to-ekza.md)).
To check a file locally against OMOBA's validator: `node tooling/omoba-validate.mjs your-file.vrm` (a checkout of
`omoba-bevy` is needed).

## Switching to Studio

**Open in Studio ▸** in the header takes the same document — with its undo history — into Studio's Rig & Skin (or
Animate from step ④). In Studio, *File › Auto-Rig This Model…* or *Help › Switch to Auto-Rig* brings it back. `⋯ ›
Open in Studio (new tab)` opens a copy in a new tab. If you reload the page, the wizard offers *Continue where you left
off* (`Ctrl/⌘+Enter` takes it); Studio reloaded after a hand-over offers the same work in its *Recover unsaved work*
dialog.

## Keys

| Keys | Action |
|---|---|
| `Ctrl/⌘+Enter` | the step's main button |
| `Alt+1` … `Alt+5` | go to a step |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` | undo, redo (on ② Markers: your marker moves) |
| `Esc` | stop the preview, cancel a gesture |
| `↑` `↓` in the marker list; arrows elsewhere | select a marker; nudge it (Shift: finer) |
| `G` | guess the markers again |
| `/`, `Enter`, `A`, `Space` | ④: search, preview the focused card, add it, play/stop |
| `⋯ › Keyboard shortcuts` | the full list |

## Limits, said plainly

Humanoids only (no quadrupeds or tails), symmetric bodies, no facial expressions or spring bones; a textured model
keeps its base colour image and a flat-colour model its material colours in the VRM, but other maps (normal,
emission) are not written, and a model you painted with a palette exports the palette colours instead; FBX and OBJ
arrive later.
