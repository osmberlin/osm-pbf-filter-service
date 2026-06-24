# Region cut only, strategy=smart (3 passes; completes multipolygon relations).
measure extract_smart "$WORK/$SCENARIO.pbf" -- \
  osmium extract --overwrite --bbox "$BBOX" --strategy smart -o "$WORK/$SCENARIO.pbf" "$INPUT"
