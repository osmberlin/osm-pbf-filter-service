# Region cut only, strategy=simple (1 pass, least RAM, geometrically incomplete).
measure extract_simple "$WORK/$SCENARIO.pbf" -- \
  osmium extract --overwrite --bbox "$BBOX" --strategy simple -o "$WORK/$SCENARIO.pbf" "$INPUT"
