# Tag-filter the whole country, INCLUDING referenced objects (osmium default:
# up to 3 passes, keeps ID tables in RAM) -> complete geometry.
measure tagfilter_include "$WORK/$SCENARIO.pbf" -- \
  osmium tags-filter --overwrite -o "$WORK/$SCENARIO.pbf" "$INPUT" "${TAGS[@]}"
