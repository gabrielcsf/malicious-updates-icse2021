#!/bin/bash

rm -f ./performance-reports-consolidated.txt

while IFS='' read -r line || [[ -n "$line" ]]; do
   # require checks
	 if [ -e "packages/$line/performance-output.txt" ]; then
   	IMPORTS=$(cat "packages/$line/performance-output.txt" | grep '[PERM-ERROR-REPORT]' | grep 'imports' | wc -l | xargs);
   	MEMBEREXPRS=$(cat "packages/$line/performance-output.txt" | grep '[PERM-ERROR-REPORT]' | grep 'blacklisted property' | wc -l | xargs);
   	MEMBEREXPRS_PROPREWRITES=$(cat "packages/$line/performance-output.txt" | grep '$prop' | grep -v 'function $prop' | wc -l | xargs);
   	echo "$line;$IMPORTS;$MEMBEREXPRS;$MEMBEREXPRS_PROPREWRITES" >> performance-reports-consolidated.txt
	else
 	 echo "Skipping packages/$line/performance-output.txt, because it does not exist! Check the previous step."
	fi
done < "packages-list.txt";
