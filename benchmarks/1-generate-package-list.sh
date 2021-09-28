#!/bin/bash

REPO_DIR="./packages"

echo "Removing old list of packages from $REPO_DIR..";
rm -f packages-list.txt

echo "Generating new list of packages.."
ls -1 $REPO_DIR > packages-list.txt

echo "Installing cli apps ";
while IFS='' read -r line || [[ -n "$line" ]]; do
	cd $REPO_DIR/$line/
	npm install
	cd $REPO_DIR
done < "packages-list.txt";

echo "Done!"
