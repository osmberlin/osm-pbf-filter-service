# Tag-filter the whole country, OMITTING referenced objects (-R: 1 pass, no ID
# tables) -> smaller + cheaper, but ways/relations lose their geometry.
measure tagfilter_omit "$WORK/$SCENARIO.pbf" -- \
  osmium tags-filter --overwrite -R -o "$WORK/$SCENARIO.pbf" "$INPUT" "${TAGS[@]}"
