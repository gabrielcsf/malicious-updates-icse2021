#!/bin/bash

ROOT_DIR=$(pwd)

# delete old measurements
echo "Deleting old measurements"
find $ROOT_DIR/packages -iname "performance-output*.txt" -depth -exec rm {} \;

NODE1=$(which nodepermsys)

if [ "$NODE1" == "" ]; then
	echo "nodepermsys not found";
	exit 1
fi

# define number of runs
TOTAL_RUNS=1

# execute programs
i=1;
while [[ $i -le TOTAL_RUNS ]]; do
  echo "Running performance tests: $i [$NODE1]";

  # iterating over programs
  while IFS='' read -r app || [[ -n "$app" ]]; do
    echo "Running app $app ..";
    cd "$ROOT_DIR/packages/$app/";

    # executing program with instance of node (original or with permsys)
    ts1=$(gdate +%s%N); ./run.sh $NODE1 >> ./performance-output.txt; echo $((($(gdate +%s%N) - $ts1)/1000000))

    cd "$ROOT_DIR";	
  done < "packages-list.txt";
  (( i++ ))
done
