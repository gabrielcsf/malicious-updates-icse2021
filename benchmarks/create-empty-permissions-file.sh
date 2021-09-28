#!/bin/bash

PKGS_DIR="./packages"
REPO_DIR="./node_modules"

while IFS='' read -r line || [[ -n "$line" ]]; do
   ### Identifying dependencies required in each file 
   echo "Extracting permissions for dependencies of package: $line";

   SUB_DIR=$(ls -1A $PKGS_DIR/$line/$REPO_DIR);

   for DIR in $SUB_DIR; do
      echo "$line->$DIR"
      touch -f $PKGS_DIR/$line/$REPO_DIR/$DIR/permissions.txt
   done     
done < "packages-list.txt";