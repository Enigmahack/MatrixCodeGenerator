import re

with open("MatrixCode_v8.5/js/config/ConfigurationManager.js", "r") as f:
    content = f.read()

# Fix typo in the properties list
generator_properties = [
    ("SpineBoost", 4),
    ("FillThreshold", 0.33),
    ("MaxBlockScale", 3),
    ("GenerativeScaling", False),
    ("AllowAsymmetry", False),
    ("QuadrantCount", "4"),
    ("BlockSpawnerEnabled", True),
    ("BlockSpawnerStartDelay", 10),
    ("BlockSpawnerRate", 4),
    ("BlockSpawnerCount", 5),
    ("BlockSpawnerDespawnRate", 8),
    ("BlockSpawnerDespawnCount", 2),
    ("HoleFillerEnabled", True),
    ("HoleFillerRate", 1),
    ("SpreadingNudgeEnabled", False),
    ("SpreadingNudgeStartDelay", 20),
    ("SpreadingNudgeChance", 0.3),
    ("SpreadingNudgeSpawnSpeed", 1),
    ("SpreadingNudgeMaxInstances", 20),
    ("SpreadingNudgeRange", 0.5),
    ("SpreadingNudgeSymmetry", True),
    ("ShoveFillEnabled", False),
    ("ShoveFillStartDelay", 20),
    ("ShoveFillRate", 4),
    ("ShoveFillAmount", 1),
    ("InsideOutEnabled", True),
    ("InsideOutDelay", 6),
    ("InsideOutBucketSize", 3),
    ("InsideOutStepsBetweenBuckets", 3),
    ("NudgeEnabled", True),
    ("NudgeStartDelay", 4),
    ("NudgeChance", 0.3),
    ("L3AllowNudges", True),
    ("ShiftFrequency", 5),
    ("ShiftMaxThickness", 5),
    ("EnableSyncSubLayers", True)
]

insertion_point = '"quantizedDefaultGlassRefractionGlow": 0.5,'
new_defaults = insertion_point + "\n"
for prop, val in generator_properties:
    if isinstance(val, str):
        new_defaults += f'            "quantizedDefault{prop}": "{val}",\n'
    elif isinstance(val, bool):
        new_defaults += f'            "quantizedDefault{prop}": {str(val).lower()},\n'
    else:
        new_defaults += f'            "quantizedDefault{prop}": {val},\n'

content = content.replace(insertion_point, new_defaults)

with open("MatrixCode_v8.5/js/config/ConfigurationManager.js", "w") as f:
    f.write(content)
