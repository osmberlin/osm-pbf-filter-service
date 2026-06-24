# Alternative order: tag-filter the whole country first (sparse union), then cut
# the sub-region from the much smaller tagged file. Two steps; total = sum.
tagged="$WORK/$SCENARIO.tagged.pbf"
final="$WORK/$SCENARIO.final.pbf"
measure global_tagfilter "$tagged" -- \
  osmium tags-filter --overwrite -o "$tagged" "$INPUT" "${TAGS[@]}"
measure region_extract "$final" -- \
  osmium extract --overwrite --bbox "$BBOX" --strategy smart -o "$final" "$tagged"
