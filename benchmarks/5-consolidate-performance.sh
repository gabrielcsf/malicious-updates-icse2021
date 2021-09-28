#!/bin/bash

rm ./performance-consolidated.txt

while IFS='' read -r line || [[ -n "$line" ]]; do
   # nodejs permsys execution time
   RESULTS=$(cat "packages/$line/performance-time-permsys.txt")
   for RESULT in $RESULTS; do
      echo "$line;permsys;$RESULT" >> performance-consolidated.txt
   done

   # nodejs original execution time
   RESULTS2=$(cat "packages/$line/performance-time-original.txt")
   for RESULT in $RESULTS2; do
      echo "$line;original;$RESULT" >> performance-consolidated.txt
   done

done < "packages-list.txt";
