#!/bin/bash

PKG_DIR="$1"

### Identifying dependencies required in each file 
echo "Processing javascript files in the package: $PKG_DIR";
FILES=$(find "$PKG_DIR" -type f -name "*.js");

if [[ ! -f $PKG_DIR/processed.txt ]]; then
   touch $PKG_DIR/processed.txt;
   rm -f "$PKG_DIR/required_dependencies.txt";
   rm -f "$PKG_DIR/declared_dependencies.txt";

   for file in $FILES; do
      echo "Searching for require instances in file ${file}";
      REQ_MP_INSTANCES=$((node parseJSFile.js $file $PKG_DIR) 2> "$PKG_DIR/parsing-error.txt")
      for instance in $REQ_MP_INSTANCES; do
         $(echo "$file;$instance"  >> "$PKG_DIR/required_dependencies.txt"); 
      done   
   done

   ### Saving list of analyzed files (for sanity check)
   $(IFS='\n'; echo "$FILES" > "$PKG_DIR/analyzed_files.txt");

   echo "Processing declared dependencies in the package.json file for package: $line"
   if [ -f $PKG_DIR/package.json ]; then
      DECLARED_DEP=$(jq -r '.dependencies' "$PKG_DIR/package.json" | jq -r 'to_entries[] | "\(.key);\(.value)"');
      DEV_DEP=$(jq -r '.devDependencies' "$PKG_DIR/package.json" | jq -r 'to_entries[] | "\(.key);\(.value)"');
      $(IFS=$'\n'; echo "${DECLARED_DEP[*]}" > $PKG_DIR/declared_dependencies.txt);
      $(IFS=$'\n'; echo "${DEV_DEP[*]}" > $PKG_DIR/dev_dependencies.txt);
   fi
else
   echo "Package $line already processed. Skippping..";
fi