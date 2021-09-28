#!/bin/bash

ROOT_DIR=$(pwd)

NODE1=$(which nodepermsys)
NODE2=$(which nodeoriginal)

if [ "$NODE1" == "" ]; then
	echo "nodepermsys not found";
	exit 1
fi

if [ "$NODE2" == "" ]; then
	echo "nodeoriginal not found";
	exit 1
fi

# setup node binaries swap for alternated experiments
swap() {
  TMP=$NODE1
  NODE1=$NODE2
  NODE2=$TMP
}

# delete old measurements
echo "Deleting old measurements..";
find $ROOT_DIR/packages -iname "performance*.txt" -depth -exec rm {} \;

# define number of runs
TOTAL_RUNS=10
echo "Defining number of experiments: $TOTAL_RUNS";

# execute programs
# i=1;
# while [[ $i -le TOTAL_RUNS ]]; do
#   swap
#   echo "Running performance tests: $i [$NODE1, $NODE2]";
#
#   # iterating over programs
#   while IFS='' read -r app || [[ -n "$app" ]]; do
#     echo "Running app $app ..";
#     cd "$ROOT_DIR/packages/$app/";
#
#       # executing program with instance of node (original or with permsys)
#     	ts1=$(gdate +%s%N); ./run.sh $NODE1 >> ./performance-output.txt; echo $((($(gdate +%s%N) - $ts1)/1000000)) >> ./performance-time-original.txt;
#
#       # executing program with alternate instance of node
#     	ts2=$(gdate +%s%N); ./run.sh $NODE2 >> ./performance-output.txt; echo $((($(gdate +%s%N) - $ts2)/1000000))  >> ./performance-time-permsys.txt;
#
#     cd "$ROOT_DIR";
#   done < "packages-list.txt";
#   (( i++ ))
# done
