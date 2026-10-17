// AnimX golden generator for @ekza-animator/anim-core (MVP-SPEC §6.3, ADR 0003). MIT, Ekza Animator contributors.
//
// Builds deterministic curves (hand-picked cases plus seeded random ones) in the Ekza key model, feeds them to
// Autodesk AnimX through an `adsk::ICurve` adapter and prints JSON goldens to stdout:
//   - curve values from `adsk::evaluateCurve` (segments, span rules, monotonic-X correction, infinities);
//   - auto/autoMix/autoEase slopes from `adsk::autoTangent`.
// Tangent types that AnimX does not compute (linear, spline, clamped, flat, step, fixed) are converted by this adapter
// with the same rules as the TypeScript engine (MVP-SPEC §4.11.4), so they validate evaluation, not the rule.
//
// Build: see README.md (generate.mjs compiles this file together with AnimX's animx.cpp, -ffp-contract=off and
// MAYA_64BIT_TIME_PRECISION, so AnimX's float64 arithmetic matches JavaScript's).

#include <algorithm>
#include <cassert>
#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "animx.h"

#ifndef MAYA_64BIT_TIME_PRECISION
#error "Build with -DMAYA_64BIT_TIME_PRECISION so AnimX times are float64"
#endif

namespace {

enum class TT { Auto, AutoEase, AutoMix, Spline, Clamped, Plateau, Linear, Flat, Step, StepNext, Fixed };
const char *const TT_NAMES[] = {"auto",   "autoEase", "autoMix", "spline",   "clamped", "plateau",
                                "linear", "flat",     "step",    "stepNext", "fixed"};
const int TT_COUNT = 11;

enum class Inf { Constant, Linear, Cycle, CycleOffset, Oscillate };
const char *const INF_NAMES[] = {"constant", "linear", "cycle", "cycleOffset", "oscillate"};

struct Key {
  double t, v;
  TT inType, outType;
  double inDt, inDv, outDt, outDv;
};

struct Curve {
  std::string name;
  std::vector<Key> keys;
  bool weighted;
  Inf pre, post;
  std::vector<double> times;
};

bool isAuto(TT t) { return t == TT::Auto || t == TT::AutoEase || t == TT::AutoMix; }

adsk::TangentType animxAutoType(TT t) {
  switch (t) {
  case TT::AutoEase:
    return adsk::TangentType::AutoEase;
  case TT::AutoMix:
    return adsk::TangentType::AutoMix;
  default:
    return adsk::TangentType::Auto;
  }
}

adsk::InfinityType animxInfinity(Inf i) {
  switch (i) {
  case Inf::Constant:
    return adsk::InfinityType::Constant;
  case Inf::Linear:
    return adsk::InfinityType::Linear;
  case Inf::Cycle:
    return adsk::InfinityType::Cycle;
  case Inf::CycleOffset:
    return adsk::InfinityType::CycleRelative;
  case Inf::Oscillate:
    return adsk::InfinityType::Oscillate;
  }
  return adsk::InfinityType::Constant;
}

// ---------- adapter: Ekza keys -> AnimX keyframes ----------

class Adapter : public adsk::ICurve {
public:
  explicit Adapter(const Curve &c) : curve(c) {
    const size_t n = c.keys.size();
    double vMin = INFINITY, vMax = -INFINITY;
    for (const Key &k : c.keys) {
      vMin = std::min(vMin, k.v);
      vMax = std::max(vMax, k.v);
    }
    clampedEps = 1e-5 * std::max(1.0, std::fabs(vMax - vMin));
    frames.resize(n);
    for (size_t i = 0; i < n; i++) build((int)i);
  }

  bool keyframeAtIndex(int index, adsk::Keyframe &key) const override {
    if (index < 0 || index >= (int)frames.size()) return false;
    key = frames[(size_t)index];
    return true;
  }
  bool keyframe(double time, adsk::Keyframe &key) const override {
    if (frames.empty()) return false;
    for (const adsk::Keyframe &k : frames) {
      if (k.time >= time) {
        key = k;
        return true;
      }
    }
    key = frames.back();
    return true;
  }
  bool first(adsk::Keyframe &key) const override { return keyframeAtIndex(0, key); }
  bool last(adsk::Keyframe &key) const override { return keyframeAtIndex((int)frames.size() - 1, key); }
  adsk::InfinityType preInfinityType() const override { return animxInfinity(curve.pre); }
  adsk::InfinityType postInfinityType() const override { return animxInfinity(curve.post); }
  bool isWeighted() const override { return curve.weighted; }
  unsigned int keyframeCount() const override { return (unsigned int)frames.size(); }
  bool isStatic() const override { return false; }

  /** AnimX slope (y/x) of an auto-family side; NaN when the side is not auto. */
  double autoSlope(int i, bool in) const {
    const Key &k = curve.keys[(size_t)i];
    if (!isAuto(in ? k.inType : k.outType)) return NAN;
    const adsk::Tangent &tan = in ? frames[(size_t)i].tanIn : frames[(size_t)i].tanOut;
    return tan.y / tan.x;
  }

private:
  const Curve &curve;
  std::vector<adsk::Keyframe> frames;
  double clampedEps = 0;

  // (x, y) of a side in AnimX convention: x > 0 points forward in time for both sides, the control point sits at
  // x/3 (out: key + (x, y)/3, in: key − (x, y)/3).
  void side(int i, bool in, TT type, double &x, double &y) const {
    const std::vector<Key> &keys = curve.keys;
    const int n = (int)keys.size();
    const Key &k = keys[(size_t)i];
    const bool hasPrev = i > 0, hasNext = i < n - 1;
    const double chordIn = hasPrev ? (k.v - keys[(size_t)i - 1].v) / (k.t - keys[(size_t)i - 1].t) : NAN;
    const double chordOut = hasNext ? (keys[(size_t)i + 1].v - k.v) / (keys[(size_t)i + 1].t - k.t) : NAN;
    const double spanIn = hasPrev ? k.t - keys[(size_t)i - 1].t : hasNext ? keys[(size_t)i + 1].t - k.t : 1;
    const double spanOut = hasNext ? keys[(size_t)i + 1].t - k.t : hasPrev ? k.t - keys[(size_t)i - 1].t : 1;
    const double span = in ? spanIn : spanOut;
    double slope = 0;
    switch (type) {
    case TT::Fixed:
      if (in) {
        x = -3.0 * k.inDt;
        y = -3.0 * k.inDv;
        assert(x * (1.0 / 3.0) == -k.inDt && y * (1.0 / 3.0) == -k.inDv);
      } else {
        x = 3.0 * k.outDt;
        y = 3.0 * k.outDv;
        assert(x * (1.0 / 3.0) == k.outDt && y * (1.0 / 3.0) == k.outDv);
      }
      return;
    case TT::Auto:
    case TT::AutoEase:
    case TT::AutoMix:
    case TT::Plateau: {
      adsk::KeyTimeValue key{k.t, k.v};
      adsk::KeyTimeValue prev{}, next{};
      if (hasPrev) prev = adsk::KeyTimeValue{keys[(size_t)i - 1].t, keys[(size_t)i - 1].v};
      if (hasNext) next = adsk::KeyTimeValue{keys[(size_t)i + 1].t, keys[(size_t)i + 1].v};
      adsk::seconds tx = 0, ty = 0;
      adsk::autoTangent(in, animxAutoType(type), key, hasPrev ? &prev : nullptr, hasNext ? &next : nullptr,
                        curve.weighted ? adsk::CurveInterpolatorMethod::Bezier : adsk::CurveInterpolatorMethod::Hermite,
                        tx, ty);
      x = tx;
      y = ty;
      return;
    }
    case TT::Flat:
    case TT::Step:
    case TT::StepNext:
      slope = 0;
      break;
    case TT::Linear:
      slope = in ? (hasPrev ? chordIn : hasNext ? chordOut : 0) : (hasNext ? chordOut : hasPrev ? chordIn : 0);
      break;
    case TT::Spline:
    case TT::Clamped:
      if (type == TT::Clamped && ((hasPrev && std::fabs(k.v - keys[(size_t)i - 1].v) <= clampedEps) ||
                                  (hasNext && std::fabs(keys[(size_t)i + 1].v - k.v) <= clampedEps))) {
        slope = 0;
      } else if (hasPrev && hasNext) {
        slope = (keys[(size_t)i + 1].v - keys[(size_t)i - 1].v) / (keys[(size_t)i + 1].t - keys[(size_t)i - 1].t);
      } else {
        slope = hasPrev ? chordIn : hasNext ? chordOut : 0;
      }
      break;
    }
    x = span;
    y = slope * span;
  }

  static adsk::TangentType flagType(TT t) {
    switch (t) {
    case TT::Linear:
      return adsk::TangentType::Linear;
    case TT::Step:
      return adsk::TangentType::Step;
    case TT::StepNext:
      return adsk::TangentType::StepNext;
    default:
      return adsk::TangentType::Fixed;
    }
  }

  void build(int i) {
    const std::vector<Key> &keys = curve.keys;
    const Key &k = keys[(size_t)i];
    adsk::Keyframe &f = frames[(size_t)i];
    f.index = i;
    f.time = k.t;
    f.value = k.v;
    f.quaternionW = 1.0;
    double x = 0, y = 0;
    side(i, true, k.inType, x, y);
    f.tanIn = adsk::Tangent{flagType(k.inType), x, y};
    side(i, false, k.outType, x, y);
    f.tanOut = adsk::Tangent{flagType(k.outType), x, y};
    // Span rule (MVP-SPEC §4.11.4): the span i → i+1 is linear iff i.out and (i+1).in are both linear.
    f.linearInterpolation =
        i + 1 < (int)keys.size() && k.outType == TT::Linear && keys[(size_t)i + 1].inType == TT::Linear;
  }
};

// ---------- deterministic random numbers (splitmix64) ----------

struct Rng {
  uint64_t state;
  uint64_t next() {
    uint64_t z = (state += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
  }
  int range(int lo, int hi) { return lo + (int)(next() % (uint64_t)(hi - lo + 1)); } // inclusive
  bool chance(int percent) { return range(0, 99) < percent; }
};

Key makeKey(double t, double v, TT in, TT out) { return Key{t, v, in, out, 0, 0, 0, 0}; }

// ---------- cases ----------

void addSamples(Curve &c, Rng &rng, int randomCount, double margin) {
  const double t0 = c.keys.front().t, t1 = c.keys.back().t;
  const double range = std::max(t1 - t0, 1.0);
  const double lo = t0 - margin * range - 1, hi = t1 + margin * range + 1;
  for (const Key &k : c.keys) c.times.push_back(k.t);
  for (size_t i = 0; i + 1 < c.keys.size(); i++) c.times.push_back((c.keys[i].t + c.keys[i + 1].t) / 2);
  // tick-aligned (multiples of 1/64 frame) so AnimX's tick rounding of mapped infinity times is exact
  const int64_t a = (int64_t)std::ceil(lo * 64), b = (int64_t)std::floor(hi * 64);
  for (int i = 0; i < randomCount; i++) c.times.push_back((double)(a + (int64_t)(rng.next() % (uint64_t)(b - a + 1))) / 64);
  std::sort(c.times.begin(), c.times.end());
  c.times.erase(std::unique(c.times.begin(), c.times.end()), c.times.end());
}

std::vector<Curve> handPicked(Rng &rng) {
  std::vector<Curve> out;
  const TT kinds[] = {TT::Auto, TT::AutoEase, TT::AutoMix, TT::Spline, TT::Clamped, TT::Linear, TT::Flat};
  const Inf infs[] = {Inf::Constant, Inf::Linear, Inf::Cycle, Inf::CycleOffset, Inf::Oscillate};
  // every computed type × weighted × every infinity (pre = post), on an asymmetric 4-key curve
  for (TT kind : kinds) {
    for (int w = 0; w < 2; w++) {
      for (Inf inf : infs) {
        Curve c;
        c.name = std::string("type-") + TT_NAMES[(int)kind] + (w ? "-weighted-" : "-") + INF_NAMES[(int)inf];
        c.weighted = w != 0;
        c.pre = inf;
        c.post = inf;
        c.keys = {makeKey(-4, 1.5, kind, kind), makeKey(2, 3.25, kind, kind), makeKey(5, 3.25, kind, kind),
                  makeKey(13, -2.5, kind, kind)};
        addSamples(c, rng, 48, 3.5);
        out.push_back(c);
      }
    }
  }
  // the wave clip (30° / −30° / 30° at 0 / 15 / 30) in radians, with E2E-08's tangent edits
  const double deg = 3.14159265358979323846 / 180.0;
  const TT waveTypes[][3] = {{TT::Auto, TT::Auto, TT::Auto},
                             {TT::Linear, TT::Linear, TT::Linear},
                             {TT::Auto, TT::Linear, TT::Auto},
                             {TT::Step, TT::Step, TT::Step}};
  const char *waveNames[] = {"wave-auto", "wave-linear", "wave-linear-key15", "wave-step"};
  for (int s = 0; s < 4; s++) {
    for (Inf inf : {Inf::Constant, Inf::Cycle}) {
      Curve c;
      c.name = std::string(waveNames[s]) + "-" + INF_NAMES[(int)inf];
      c.weighted = false;
      c.pre = inf;
      c.post = inf;
      c.keys = {makeKey(0, 30 * deg, waveTypes[s][0], waveTypes[s][0]),
                makeKey(15, -30 * deg, waveTypes[s][1], waveTypes[s][1]),
                makeKey(30, 30 * deg, waveTypes[s][2], waveTypes[s][2])};
      addSamples(c, rng, 40, 2.5);
      c.times.push_back(7.5);
      c.times.push_back(14);
      c.times.push_back(29);
      std::sort(c.times.begin(), c.times.end());
      c.times.erase(std::unique(c.times.begin(), c.times.end()), c.times.end());
      out.push_back(c);
    }
  }
  // segment kinds: step / stepNext only affect the span after the key
  {
    Curve c;
    c.name = "span-step-next";
    c.weighted = false;
    c.pre = Inf::Constant;
    c.post = Inf::Constant;
    c.keys = {makeKey(0, 0, TT::Auto, TT::StepNext), makeKey(4, 2, TT::Auto, TT::Step), makeKey(8, -1, TT::Linear, TT::Linear),
              makeKey(10, 3, TT::Linear, TT::Auto), makeKey(16, 0, TT::Auto, TT::Auto)};
    addSamples(c, rng, 40, 0.5);
    out.push_back(c);
  }
  // weighted handles beyond the span: monotonic-X correction, both constrainInsideBounds branches, negative dt
  struct H {
    const char *name;
    double outDt, outDv, inDt, inDv;
  };
  const H handles[] = {
      {"weighted-in-range", 2, 1, -3, 0.5},     {"weighted-out-long", 9, 2, -1, -1},
      {"weighted-in-long", 1, 0.5, -9, 1},      {"weighted-both-long", 7, 1, -7, -1},
      {"weighted-out-very-long", 14, 3, -2, 0}, {"weighted-out-negative", -2, 1, -2, 1},
      {"weighted-in-positive", 2, 1, 2, -1},    {"weighted-vertical-ish", 0.015625, 4, -0.015625, -4},
      {"weighted-ellipse-edge", 8, 0, -4, 0},
  };
  for (const H &h : handles) {
    Curve c;
    c.name = h.name;
    c.weighted = true;
    c.pre = Inf::Constant;
    c.post = Inf::Constant;
    Key a = makeKey(0, 0, TT::Flat, TT::Fixed), b = makeKey(6, 2, TT::Fixed, TT::Flat);
    a.outDt = h.outDt;
    a.outDv = h.outDv;
    b.inDt = h.inDt;
    b.inDv = h.inDv;
    c.keys = {a, b};
    addSamples(c, rng, 60, 0.2);
    out.push_back(c);
  }
  return out;
}

double gridValue(Rng &rng) { return (double)rng.range(-128, 128) / 16; }

std::vector<Curve> randomCurves(Rng &rng, int count) {
  std::vector<Curve> out;
  for (int ci = 0; ci < count; ci++) {
    Curve c;
    char name[32];
    std::snprintf(name, sizeof name, "random-%04d", ci);
    c.name = name;
    c.weighted = rng.chance(50);
    const int n = rng.range(2, 7);
    c.pre = (Inf)rng.range(0, 4);
    c.post = (Inf)rng.range(0, 4);
    double t = rng.range(-20, 20);
    double v = gridValue(rng);
    for (int i = 0; i < n; i++) {
      if (i > 0) {
        t += rng.chance(20) ? (double)rng.range(1, 15) / 8 : rng.range(1, 12);
        const int r = rng.range(0, 9);
        v = r == 0 ? v : r == 1 ? v + (double)rng.range(-4, 4) / 1024 : gridValue(rng);
      }
      Key k = makeKey(t, v, (TT)rng.range(0, TT_COUNT - 1), (TT)rng.range(0, TT_COUNT - 1));
      c.keys.push_back(k);
    }
    for (int i = 0; i < n; i++) {
      Key &k = c.keys[(size_t)i];
      const double spanIn = i > 0 ? k.t - c.keys[(size_t)i - 1].t : 4;
      const double spanOut = i < n - 1 ? c.keys[(size_t)i + 1].t - k.t : 4;
      // multiples of 1/64; weighted handles may exceed their span (monotonic correction)
      const double inMax = c.weighted ? 1.6 * spanIn : spanIn;
      const double outMax = c.weighted ? 1.6 * spanOut : spanOut;
      k.inDt = -(double)rng.range(1, std::max(1, (int)(inMax * 64))) / 64;
      k.outDt = (double)rng.range(1, std::max(1, (int)(outMax * 64))) / 64;
      k.inDv = (double)rng.range(-256, 256) / 64;
      k.outDv = (double)rng.range(-256, 256) / 64;
    }
    addSamples(c, rng, 28, 2.6);
    out.push_back(c);
  }
  return out;
}

// ---------- JSON output ----------

void printNumber(double x) {
  if (x == 0) {
    std::printf("0");
    return;
  }
  char buf[40];
  std::snprintf(buf, sizeof buf, "%.17g", x);
  // shortest round-trip representation
  for (int p = 1; p <= 17; p++) {
    char shorter[40];
    std::snprintf(shorter, sizeof shorter, "%.*g", p, x);
    if (std::strtod(shorter, nullptr) == x) {
      std::strcpy(buf, shorter);
      break;
    }
  }
  std::printf("%s", buf);
}

void printCurve(const Curve &c, bool last) {
  Adapter a(c);
  std::printf("{\"name\":\"%s\",\"weighted\":%s,\"pre\":\"%s\",\"post\":\"%s\",\"keys\":[", c.name.c_str(),
              c.weighted ? "true" : "false", INF_NAMES[(int)c.pre], INF_NAMES[(int)c.post]);
  for (size_t i = 0; i < c.keys.size(); i++) {
    const Key &k = c.keys[i];
    std::printf("%s[", i ? "," : "");
    printNumber(k.t);
    std::printf(",");
    printNumber(k.v);
    std::printf(",\"%s\",\"%s\",", TT_NAMES[(int)k.inType], TT_NAMES[(int)k.outType]);
    printNumber(k.inDt);
    std::printf(",");
    printNumber(k.inDv);
    std::printf(",");
    printNumber(k.outDt);
    std::printf(",");
    printNumber(k.outDv);
    std::printf("]");
  }
  std::printf("],\"autoSlopes\":[");
  bool firstSlope = true;
  for (size_t i = 0; i < c.keys.size(); i++) {
    for (int in = 1; in >= 0; in--) {
      const double s = a.autoSlope((int)i, in != 0);
      if (std::isnan(s)) continue;
      std::printf("%s[%zu,\"%s\",", firstSlope ? "" : ",", i, in ? "in" : "out");
      printNumber(s);
      std::printf("]");
      firstSlope = false;
    }
  }
  std::printf("],\"samples\":[");
  for (size_t i = 0; i < c.times.size(); i++) {
    const double value = adsk::evaluateCurve(c.times[i], a);
    std::printf("%s[", i ? "," : "");
    printNumber(c.times[i]);
    std::printf(",");
    printNumber(value);
    std::printf("]");
  }
  std::printf("]}%s\n", last ? "" : ",");
}

} // namespace

int main(int argc, char **argv) {
  uint64_t seed = 20261017;
  int count = 320;
  for (int i = 1; i + 1 < argc; i += 2) {
    if (std::strcmp(argv[i], "--seed") == 0) seed = std::strtoull(argv[i + 1], nullptr, 10);
    else if (std::strcmp(argv[i], "--curves") == 0) count = std::atoi(argv[i + 1]);
  }
  Rng rng{seed};
  std::vector<Curve> curves = handPicked(rng);
  std::vector<Curve> random = randomCurves(rng, count);
  curves.insert(curves.end(), random.begin(), random.end());
  std::printf("{\"source\":\"https://github.com/Autodesk/animx\",\"commit\":\"%s\",\"seed\":%" PRIu64
              ",\"keyFormat\":[\"t\",\"v\",\"inType\",\"outType\",\"inDt\",\"inDv\",\"outDt\",\"outDv\"],\"curves\":[\n",
              ANIMX_COMMIT, seed);
  for (size_t i = 0; i < curves.size(); i++) printCurve(curves[i], i + 1 == curves.size());
  std::printf("]}\n");
  return 0;
}
