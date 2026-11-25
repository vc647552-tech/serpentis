#pragma once
#include <stdint.h>
#include "math_core.hpp"
#include "world_buildings.hpp"

namespace serpentis {

enum GamePhase : int32_t {
  PHASE_TITLE = 0,
  PHASE_PLAYING = 1,
  PHASE_PAUSED = 2,
  PHASE_GAMEOVER = 3,
};

enum CameraMode : int32_t {
  CAM_CHASE = 0,
  CAM_CANOPY = 1,
};

enum SnakeSpecies : int32_t {
  SPECIES_EMERALD = 0,
  SPECIES_GOLDEN = 1,
  SPECIES_OBSIDIAN = 2,
  SPECIES_RATTLER = 3,
  SPECIES_CORAL = 4,
  SPECIES_ALBINO = 5,
};

enum DifficultyLevel : int32_t {
  DIFF_RELAXED = 0,
  DIFF_REALISTIC = 1,
  DIFF_APEX = 2,
};

enum DeathReason : int32_t {
  DEATH_NONE = 0,
  DEATH_BOUNDARY = 1,
  DEATH_OBSTACLE = 2,
  DEATH_SELF = 3,
  DEATH_HUNTER = 4,
};

enum PreyKind : int32_t {
  PREY_RABBIT = 0,
  PREY_FROG = 1,
  PREY_MOUSE = 2,
  PREY_BERRY = 3,
  PREY_EGG = 4,
  PREY_DEER = 5,
  PREY_BOAR = 6,
  PREY_ELEPHANT = 7,
};

enum VillagerRole : int32_t {
  ROLE_FLEE = 0,
  ROLE_HIDE = 1,
  ROLE_SPEARMAN = 2,
  ROLE_CROSSBOW = 3,
};

enum VillagerState : int32_t {
  VSTATE_PATROL = 0,
  VSTATE_FLEEING = 1,
  VSTATE_SEEKING_SHELTER = 2,
  VSTATE_HIDING = 3,
  VSTATE_PURSUE = 4,
  VSTATE_WINDUP = 5,
  VSTATE_ATTACK = 6,
  VSTATE_RECOVER = 7,
  VSTATE_KO = 8,
};

enum SimEventType : int32_t {
  EVT_EAT = 1,
  EVT_HATCH = 2,
  EVT_LAY_EGG = 3,
  EVT_SNAKE_HURT = 4,
  EVT_VILLAGER_HIT = 5,
  EVT_HUNTER_TELEGRAPH = 6,
  EVT_CRASH = 7,
  EVT_PHASE_CHANGE = 8,
  EVT_POWER_USED = 9,
  EVT_TAIL_GRAB = 10,
  EVT_TAIL_DEVOUR = 11,
  EVT_VENOM_HIT = 12,
  EVT_BLOOD_DRINK = 13,
  EVT_SECONDARY_POWER = 14,
  EVT_RIVAL_CLASH = 15,
};

enum ProjectileKind : int32_t {
  PROJ_BOLT = 0,
  PROJ_VENOM = 1,
  PROJ_MIST = 2,
};

struct alignas(4) SimScalars {
  int32_t phase;
  int32_t cameraMode;
  int32_t species;
  int32_t difficulty;
  int32_t muted;
  int32_t isBoosting;
  int32_t kills;
  int32_t segmentCount;
  int32_t combo;
  int32_t deathReason;
  int32_t nearPrey;
  int32_t hunterAlert;
  int32_t threatLevel;
  int32_t activeBuildingId;
  int32_t hideActiveRoof;
  int32_t isIndoors;
  int32_t locZoneType;
  int32_t locZoneIdx;
  int32_t locBuildingIdx;
  int32_t totalHatched;
  int32_t nextId;
  int32_t spineLen;
  int32_t obstaclesVersion;
  int32_t maxHp;

  float headX;
  float headY;
  float headZ;
  float headVelY;
  float heading;
  float totalDist;
  float speed;
  float stamina;
  float hp;
  float invulnTimer;
  float outOfCombatTimer;
  float score;
  float bestScore;
  float comboTimer;
  float elapsedSeconds;
  float mouthOpen;
  float tongueTimer;
  float raidHeat;
  float eggCooldown;
  float turnSensitivity;
  float lastHazardScoreMilestone;
  float villagerReinforceTimer;

  // Words 46..63: Active Powers & Tail-Grab Finisher state
  int32_t grabTargetId;
  int32_t grabStage;
  int32_t powerPulseKind;
  float powerCooldown;
  float powerMaxCooldown;
  float tailGrabCooldown;
  float tailGrabMaxCooldown;
  float grabTimer;
  float grabWhipTimer;
  float grabOriginX;
  float grabOriginY;
  float grabOriginZ;
  float stealthTimer;
  float powerPulseTimer;
  float powerPulseX;
  float powerPulseY;
  float powerPulseZ;
  float padEnd;

  // Words 64..71: Progression, Growth Scale, Secondary Power & 7-Village Rivalry
  int32_t feastCount;
  int32_t powerTier;
  int32_t rivalClashActive;
  int32_t activeVillageId;
  float snakeScale;
  float secondaryCooldown;
  float secondaryMaxCooldown;
  float swallowBulgeT;
};
static_assert(sizeof(SimScalars) == 72 * 4, "SimScalars must be 72 words");

struct alignas(4) PreySlot {
  int32_t id;
  int32_t kind;
  int32_t points;
  int32_t growth;
  int32_t staminaGain;
  int32_t fleeing;
  float x, y, z, vx, vz, heading, radius, phase, gaitPhase, idleTimer;
};
static_assert(sizeof(PreySlot) == 16 * 4, "PreySlot stride");

struct alignas(4) VillagerSlot {
  int32_t id;
  int32_t role;
  int32_t state;
  float hp;
  float maxHp;
  int32_t targetBuildingId;
  int32_t shirtColor;
  int32_t trouserColor;
  int32_t hairColor;
  int32_t skinTone;
  int32_t hasBeard;
  int32_t isElite;
  int32_t tier;
  float x, y, z, vx, vz, heading, radius, speed, gaitPhase, phase;
  float homeX, homeZ, stateTimer, attackCooldown, hitFlash, koTimer;
  float poisonTimer;
  float stunTimer;
  int32_t grabbed;
  int32_t homeVillageId;
  int32_t targetVillagerId;
  float herdedTimer;
  int32_t padV1;
};
static_assert(sizeof(VillagerSlot) == 36 * 4, "VillagerSlot stride");

struct alignas(4) LaidEggSlot {
  int32_t id;
  int32_t species;
  float x, y, z, age, hatchTime, pad;
};
static_assert(sizeof(LaidEggSlot) == 8 * 4, "LaidEggSlot stride");

struct alignas(4) HatchlingSlot {
  int32_t id;
  int32_t stage;
  int32_t targetVillagerId;
  int32_t targetPreyId;
  int32_t poseCount;
  int32_t spineLen;
  float x, y, z, heading, speed, growth, biteCooldown, totalDist;
  float pad0, pad1;
};
static_assert(sizeof(HatchlingSlot) == 16 * 4, "HatchlingSlot stride");

struct alignas(4) ProjectileSlot {
  int32_t id;
  int32_t damage;
  float x, y, z, vx, vy, vz, yaw, life;
  int32_t kind; // 0 = hunter bolt, 1 = player venom, 2 = player mist
  float radius;
  int32_t ownerVillageId; // -1 for player, 0..6 for village hunters
  int32_t padP1;
  int32_t padP2;
  int32_t padP3;
};
static_assert(sizeof(ProjectileSlot) == 16 * 4, "ProjectileSlot stride");

struct alignas(4) ObstacleSlot {
  int32_t id;
  int32_t kind; // 0 = boulder, 1 = log
  float x, z, radius, rotation, scale, pad;
};
static_assert(sizeof(ObstacleSlot) == 8 * 4, "ObstacleSlot stride");

struct alignas(4) TreeSlot {
  int32_t id;
  int32_t kind; // 0 = oak, 1 = pine
  float x, z, radius, scale, pad0, pad1;
};
static_assert(sizeof(TreeSlot) == 8 * 4, "TreeSlot stride");

struct alignas(4) SimEvent {
  int32_t type;
  int32_t a;
  int32_t b;
  int32_t c;
  float x, y, z, f0, f1;
  float pad0, pad1, pad2;
};
static_assert(sizeof(SimEvent) == 12 * 4, "SimEvent stride");

static constexpr int32_t MAX_PREY_POOL = 72;
static constexpr int32_t MAX_VILLAGER_POOL = 72;
static constexpr int32_t MAX_EGG_POOL = 8;
static constexpr int32_t MAX_HATCHLING_POOL = 8;
static constexpr int32_t MAX_PROJ_POOL = 96;
static constexpr int32_t MAX_OBS_POOL = 112;
static constexpr int32_t MAX_TREE_POOL = 320;
static constexpr int32_t MAX_EVENT_POOL = 128;

struct WorldSimState {
  SimScalars scalars;
  SeededRng rng;

  int32_t preyCount;
  int32_t villagerCount;
  int32_t eggCount;
  int32_t hatchlingCount;
  int32_t projectileCount;
  int32_t obstacleCount;
  int32_t treeCount;
  int32_t eventCount;

  PreySlot prey[MAX_PREY_POOL];
  VillagerSlot villagers[MAX_VILLAGER_POOL];
  LaidEggSlot laidEggs[MAX_EGG_POOL];
  HatchlingSlot hatchlings[MAX_HATCHLING_POOL];
  ProjectileSlot projectiles[MAX_PROJ_POOL];
  ObstacleSlot obstacles[MAX_OBS_POOL];
  TreeSlot trees[MAX_TREE_POOL];
  SimEvent events[MAX_EVENT_POOL];

  // Strike cooldown table keyed by villager id
  int32_t strikeCdCount;
  int32_t strikeCdIds[MAX_VILLAGER_POOL];
  float strikeCdTimers[MAX_VILLAGER_POOL];

  float rivalEventCd;

  // Player spine ring buffer (2048 slots * 4 floats: [x, y, z, dist])
  int32_t spineHeadIdx;
  float playerSpineRing[2048 * 4];
  float playerPoses[256 * 5]; // [x, y, z, yaw, radius]

  // Hatchling spines & poses
  float hatchlingSpines[MAX_HATCHLING_POOL][64 * 4];
  float hatchlingPoses[MAX_HATCHLING_POOL][32 * 5];
};

extern WorldSimState g_sim;

void sim_init(uint32_t seed);
void sim_reset_world(bool isTitleDemo);
void sim_start_game();
void sim_set_phase(int32_t nextPhase);
void sim_toggle_pause();
bool sim_can_lay_egg();
bool sim_lay_egg();
bool sim_trigger_primary_power();
bool sim_trigger_tail_grab();
bool sim_trigger_bite_action();
bool sim_trigger_secondary_power();
void sim_step_title_demo(float dt);
void sim_step(
    float dt,
    int32_t left,
    int32_t right,
    int32_t up,
    int32_t down,
    int32_t boost,
    float steerAxis,
    float moveThrottle,
    float joyX,
    float joyY);
void sim_damage_snake(float amount, float sourceX, float sourceY, float sourceZ);
void sim_compute_segment_poses();
void sim_recompute_hatchling_poses(int32_t hIdx);
int32_t sim_spawn_villager(int32_t role, float x, float z, int32_t tier, int32_t isElite, int32_t homeVillageId = -1);
void sim_spawn_prey(int32_t hasForcedKind, int32_t forcedKind, int32_t hasForcedPos, float fx, float fz, int32_t hasForcedY, float fy);
int32_t sim_spawn_hatchling(float x, float y, float z);

} // namespace serpentis
