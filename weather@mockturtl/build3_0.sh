#!/bin/bash
# REQUIREMENTS:
# - typescript installed
# - sed

# Getting bash script file location
scriptName=$0
DIR=$(dirname "$(realpath ${scriptName})")

# Save current dir for convenience
path=${PWD}

cd "$DIR/src/3_0"

echo Building 3.0...
cp promise-polyfill.js "$DIR/files/weather@mockturtl/3.0/"
tsc -p tsconfig.30.json
cd "$DIR"

for f in files/weather@mockturtl/3.0/*.js; do
    sed -i '/export {};/d' "$f"
done

cd "$path"