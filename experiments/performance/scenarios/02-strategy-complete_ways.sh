# Region cut only, strategy=complete_ways (osmium default; 2 passes).
measure extract_complete_ways "$WORK/$SCENARIO.pbf" -- \
  osmium extract --overwrite --bbox "$BBOX" --strategy complete_ways -o "$WORK/$SCENARIO.pbf" "$INPUT"
