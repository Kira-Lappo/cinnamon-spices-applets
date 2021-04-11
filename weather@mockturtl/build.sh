#!/bin/bash
# REQUIREMENTS:
# - typescript installed

# Getting bash script file location
scriptName=$0
DIR=$(dirname "$(realpath ${scriptName})")

# Save current dir for convenience
originalDir="${PWD}"

cd "$DIR/src/3_8"
echo Building 3.8...
tsc -p tsconfig.json
cd "$originalDir"