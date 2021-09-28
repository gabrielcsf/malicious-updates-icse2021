#!/bin/bash

REPO_DIR="./repo"

rm -rf ./npm-dependencies-consolidated.txt;

while IFS='' read -r line || [[ -n "$line" ]]; do
   echo "Processing files from package $line";
   IMPORTS=$(cat $REPO_DIR/$line/required_dependencies.txt | grep require | grep -v -E "node_modules" | egrep -v "^.*test.*[\/\.js]" | cut -d ';' -f3 | sort -u);
   METAP=$(cat $REPO_DIR/$line/required_dependencies.txt | grep meta-programming | cut -d ";" -f3 | sort -u);
#   DEPS=$(cat $REPO_DIR/$line/declared_dependencies.txt);
   
   for imported in $IMPORTS; do
      echo "$line;imported;$imported" >> npm-dependencies-consolidated.txt
   done

   for metap in $METAP; do
      echo "$line;meta-programming;$metap" >> npm-dependencies-consolidated.txt
   done
   
#   for dep in $DEPS; do
#      echo "$line;declared;$dep" >> npm-dependencies-consolidated.txt
#   done
done < "packages-list.txt";