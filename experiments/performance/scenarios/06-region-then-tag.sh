# Our pipeline order: cut the sub-region first (smart), then tag-filter the small
# region. Two steps; total = sum of both.
region="$WORK/$SCENARIO.region.pbf"
final="$WORK/$SCENARIO.final.pbf"
measure region_extract "$region" -- \
  osmium extract --overwrite --bbox "$BBOX" --strategy smart -o "$region" "$INPUT"
measure region_tagfilter "$final" -- \
  osmium tags-filter --overwrite -o "$final" "$region" "${TAGS[@]}"
