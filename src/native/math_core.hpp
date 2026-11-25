#pragma once
#include <stdint.h>

namespace serpentis {

static constexpr float PI = 3.14159265358979323846f;
static constexpr float TWO_PI = 6.28318530717958647692f;
static constexpr float HALF_PI = 1.57079632679489661923f;

static constexpr float ARENA_RADIUS = 250.0f;
static constexpr int32_t NUM_VILLAGES = 7;

struct VillageDef {
  int32_t id;
  const char* name;
  float centerX;
  float centerZ;
  float halfW;
  float halfD;
  float southGateHalfW;
  float sideGateHalfW;
  int32_t factionColorHex;
};

// Starter village (Timberhollow) bounds preserved for backward compatibility
static constexpr float VILLAGE_MIN_X = -42.0f;
static constexpr float VILLAGE_MAX_X = 42.0f;
static constexpr float VILLAGE_MIN_Z = -84.0f;
static constexpr float VILLAGE_MAX_Z = -20.0f;
static constexpr float SOUTH_GATE_HALF_W = 7.5f;
static constexpr float SIDE_GATE_HALF_W = 7.0f;

static constexpr float HEAD_RADIUS = 0.44f;
static constexpr float SEGMENT_SPACING = 0.44f;
static constexpr int32_t INITIAL_SEGMENTS = 12;
static constexpr int32_t MAX_SEGMENTS = 160;
static constexpr float START_SNAKE_SCALE = 0.48f;
static constexpr float SWALLOW_MIN_SCALE = 0.85f;
static constexpr float MAX_SNAKE_SCALE = 1.65f;

static constexpr float BASE_SPEED = 5.6f;
static constexpr float MAX_SPEED_BONUS = 3.4f;
static constexpr float BOOST_MULTIPLIER = 1.72f;
static constexpr float TURN_RATE = 3.2f;
static constexpr int32_t SELF_COLLISION_SKIP = 10;
static constexpr float COMBO_DURATION = 5.5f;
static constexpr int32_t MAX_PREY_COUNT = 64;

static constexpr int32_t MAX_SNAKE_HP = 100;
static constexpr int32_t MAX_HATCHLINGS = 8;
static constexpr float EGG_STAMINA_COST = 24.0f;
static constexpr float EGG_COOLDOWN_SEC = 2.0f;
static constexpr float EGG_HATCH_TIME_SEC = 3.8f;
static constexpr int32_t MAX_ACTIVE_ATTACKERS = 3;

static inline float c_fabsf(float x) {
  return x < 0.0f ? -x : x;
}

static inline float c_fminf(float a, float b) {
  return a < b ? a : b;
}

static inline float c_fmaxf(float a, float b) {
  return a > b ? a : b;
}

static inline float c_clampf(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

static inline float c_sqrtf(float x) {
  return x > 0.0f ? __builtin_sqrtf(x) : 0.0f;
}

static inline float c_hypotf(float a, float b) {
  return __builtin_sqrtf(a * a + b * b);
}

static inline float c_hypotf3(float a, float b, float c) {
  return __builtin_sqrtf(a * a + b * b + c * c);
}

static inline float c_floorf(float x) {
  return __builtin_floorf(x);
}

static inline float c_fmodf_pos(float x, float period) {
  float k = c_floorf(x / period);
  return x - k * period;
}

static inline float c_sinf(float x) {
  double xd = static_cast<double>(x);
  constexpr double D_TWO_PI = 6.28318530717958647692;
  constexpr double D_INV_TWO_PI = 1.0 / D_TWO_PI;
  double k = static_cast<double>(
      static_cast<int64_t>(xd * D_INV_TWO_PI + (xd >= 0.0 ? 0.5 : -0.5)));
  double r = xd - k * D_TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  double r2 = r * r;
  double res = r * (1.0 - r2 * (1.0 / 6.0 - r2 * (1.0 / 120.0 - r2 * (1.0 / 5040.0 - r2 * (1.0 / 362880.0 - r2 * (1.0 / 39916800.0))))));
  return static_cast<float>(res);
}

static inline float c_cosf(float x) {
  return c_sinf(x + HALF_PI);
}

static inline float c_atan2f(float y, float x) {
  if (x == 0.0f && y == 0.0f) return 0.0f;
  float ax = c_fabsf(x);
  float ay = c_fabsf(y);
  bool swap = ay > ax;
  float num = swap ? ax : ay;
  float den = swap ? ay : ax;
  float u = num / den;

  float base = 0.0f;
  constexpr float TAN_PI_8 = 0.41421356237309504f;
  if (u > TAN_PI_8) {
    base = 0.7853981633974483f;
    u = (u - 1.0f) / (1.0f + u);
  }
  float u2 = u * u;
  float ang = base + u * (1.0f - u2 * (0.33333333f - u2 * (0.2f - u2 * (0.14285714f - u2 * (0.11111111f - u2 * 0.09090909f)))));
  if (swap) ang = HALF_PI - ang;
  if (x < 0.0f) ang = PI - ang;
  return y < 0.0f ? -ang : ang;
}

static inline float c_expf(float x) {
  if (x < -40.0f) return 0.0f;
  if (x > 20.0f) return 485165195.0f;
  constexpr float INV_LN2 = 1.4426950408889634f;
  constexpr float LN2 = 0.6931471805599453f;
  float k_real = c_floorf(x * INV_LN2 + 0.5f);
  int32_t k = static_cast<int32_t>(k_real);
  float f = x - k_real * LN2;
  float f2 = f * f;
  float poly = 1.0f + f + f2 * (0.5f + f * (1.0f / 6.0f + f * (1.0f / 24.0f + f * (1.0f / 120.0f))));
  int32_t pow2_bits = (k + 127) << 23;
  float scale = 1.0f;
  __builtin_memcpy(&scale, &pow2_bits, sizeof(float));
  return poly * scale;
}

static inline float c_pow_sin_hu(float hu) {
  float s = c_sinf(hu * PI);
  if (s <= 0.0f) return 0.0f;
  if (s >= 1.0f) return 1.0f;
  float s2 = c_sqrtf(s);
  float s4 = c_sqrtf(s2);
  return (s2 * s4) * (0.94f + 0.06f * s);
}

static inline float c_powf_pos(float base, float exp) {
  if (base <= 0.0f) return 0.0f;
  if (base >= 1.0f) return 1.0f;
  if (exp < 0.75f) {
    float x2 = c_sqrtf(base);
    float x4 = c_sqrtf(x2);
    float x8 = c_sqrtf(x4);
    float x625 = x2 * x8;
    float x75 = x2 * x4;
    float t = (exp - 0.625f) / 0.125f;
    return x625 + (x75 - x625) * t;
  }
  float x2 = c_sqrtf(base);
  float x4 = c_sqrtf(x2);
  float x8 = c_sqrtf(x4);
  float x1375 = base * x4 * x8;
  if (exp < 1.365f) {
    return x1375 * (1.0f + (1.0f - base) * 0.015f);
  }
  return x1375;
}

static inline float normalize_angle(float angle) {
  while (angle > PI) angle -= TWO_PI;
  while (angle < -PI) angle += TWO_PI;
  return angle;
}

struct SeededRng {
  uint32_t state = 2026u;
  void reset(uint32_t s) { state = s; }
  float next() {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>(state) / 4294967295.0f;
  }
};

static inline void mat4_write_pos_scale(float* m, float x, float y, float z, float s) {
  m[0] = s;    m[1] = 0.0f; m[2] = 0.0f;  m[3] = 0.0f;
  m[4] = 0.0f; m[5] = s;    m[6] = 0.0f;  m[7] = 0.0f;
  m[8] = 0.0f; m[9] = 0.0f; m[10] = s;    m[11] = 0.0f;
  m[12] = x;   m[13] = y;   m[14] = z;    m[15] = 1.0f;
}

static inline void mat4_write_shadow_disc(float* m, float x, float y, float z, float s) {
  m[0] = s;    m[1] = 0.0f;  m[2] = 0.0f; m[3] = 0.0f;
  m[4] = 0.0f; m[5] = 0.0f;  m[6] = -s;   m[7] = 0.0f;
  m[8] = 0.0f; m[9] = 1.0f;  m[10] = 0.0f; m[11] = 0.0f;
  m[12] = x;   m[13] = y;    m[14] = z;   m[15] = 1.0f;
}

static inline void mat4_write_zero(float* m) {
  for (int i = 0; i < 16; i++) m[i] = 0.0f;
  m[15] = 1.0f;
}

} // namespace serpentis
