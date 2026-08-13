#!/usr/bin/env Rscript

# Build the Pandemic Atlas mobility aggregate from every county-level week
# published in GeoDS's Kang mobility archive.
#
# The source repository is about 1 GB as a compressed Git pack and expands to
# roughly 11 GB of CSV. To keep the project and local disk lean, this script
# reads each CSV directly from the Git object database, retains only the four
# columns required for the atlas, and accumulates compact archive totals plus a
# week-by-county inbound/outbound matrix. No raw CSV is checked into the site.

suppressPackageStartupMessages({
  library(data.table)
  library(jsonlite)
})

SOURCE_REPOSITORY <- "https://github.com/GeoDS/COVID19USFlows-WeeklyFlows.git"
SOURCE_DIRECTORY <- "weekly_flows/county2county"
EXPECTED_FIRST_WEEK <- as.Date("2019-01-07")
EXPECTED_LAST_WEEK <- as.Date("2021-12-27")
EXPECTED_WEEK_COUNT <- 156L

script_file <- sub(
  "^--file=",
  "",
  grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]
)
project_root <- normalizePath(file.path(dirname(script_file), ".."), mustWork = TRUE)
default_output <- file.path(project_root, "public", "data", "mobility.json")
default_dynamics <- file.path(project_root, "public", "data", "mobility-dynamics.json")
default_binary <- file.path(project_root, "public", "data", "mobility-weekly.bin")
default_state_pair_binary <- file.path(
  project_root,
  "public",
  "data",
  "mobility-state-pairs.bin"
)
default_geometry <- file.path(project_root, "public", "data", "county-incidence-map.json")
default_cache_root <- Sys.getenv(
  "KANG_CACHE_DIR",
  unset = file.path(path.expand("~"), ".cache", "pandemic-atlas")
)
default_repo <- file.path(default_cache_root, "kang-weekly-flows.git")

parse_args <- function(args) {
  values <- list(
    repo = Sys.getenv("KANG_WEEKLY_REPO", unset = default_repo),
    output = default_output,
    labels = default_output,
    dynamics = default_dynamics,
    binary = default_binary,
    state_pair_binary = default_state_pair_binary,
    geometry = default_geometry
  )
  for (arg in args) {
    if (startsWith(arg, "--repo=")) values$repo <- sub("^--repo=", "", arg)
    else if (startsWith(arg, "--output=")) values$output <- sub("^--output=", "", arg)
    else if (startsWith(arg, "--labels=")) values$labels <- sub("^--labels=", "", arg)
    else if (startsWith(arg, "--dynamics=")) values$dynamics <- sub("^--dynamics=", "", arg)
    else if (startsWith(arg, "--binary=")) values$binary <- sub("^--binary=", "", arg)
    else if (startsWith(arg, "--state-pair-binary=")) {
      values$state_pair_binary <- sub("^--state-pair-binary=", "", arg)
    }
    else if (startsWith(arg, "--geometry=")) values$geometry <- sub("^--geometry=", "", arg)
    else stop("Unknown argument: ", arg, call. = FALSE)
  }
  values
}

run_checked <- function(command, args, stdout = "", stderr = "") {
  status <- system2(command, args, stdout = stdout, stderr = stderr)
  if (!identical(status, 0L)) {
    stop(command, " failed with status ", status, call. = FALSE)
  }
  invisible(status)
}

ensure_source_repo <- function(repo) {
  if (dir.exists(repo)) {
    status <- suppressWarnings(system2(
      "git",
      c(paste0("--git-dir=", shQuote(repo)), "rev-parse", "--verify", "HEAD"),
      stdout = FALSE,
      stderr = FALSE
    ))
    if (identical(status, 0L)) return(normalizePath(repo, mustWork = TRUE))
    stop("Existing --repo is not a readable bare Git repository: ", repo, call. = FALSE)
  }

  dir.create(dirname(repo), recursive = TRUE, showWarnings = FALSE)
  message("Cloning the compressed Kang weekly archive into ", repo)
  run_checked(
    "git",
    c("clone", "--bare", "--depth", "1", shQuote(SOURCE_REPOSITORY), shQuote(repo))
  )
  normalizePath(repo, mustWork = TRUE)
}

git_lines <- function(repo, args) {
  output <- system2(
    "git",
    c(paste0("--git-dir=", shQuote(repo)), args),
    stdout = TRUE,
    stderr = TRUE
  )
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) {
    stop("git failed: ", paste(output, collapse = "\n"), call. = FALSE)
  }
  output
}

discover_week_files <- function(repo) {
  files <- git_lines(
    repo,
    c("ls-tree", "-r", "--name-only", "HEAD", shQuote(SOURCE_DIRECTORY))
  )
  files <- files[grepl("/weekly_county2county_[0-9]{4}_[0-9]{2}_[0-9]{2}\\.csv$", files)]
  files <- sort(files)
  dates <- as.Date(
    sub(".*weekly_county2county_([0-9]{4})_([0-9]{2})_([0-9]{2})\\.csv$", "\\1-\\2-\\3", files)
  )

  if (length(files) != EXPECTED_WEEK_COUNT) {
    stop("Expected ", EXPECTED_WEEK_COUNT, " weekly county files; found ", length(files), call. = FALSE)
  }
  if (dates[1] != EXPECTED_FIRST_WEEK || tail(dates, 1) != EXPECTED_LAST_WEEK) {
    stop(
      "Unexpected weekly archive bounds: ", dates[1], " through ", tail(dates, 1),
      call. = FALSE
    )
  }
  if (any(diff(dates) != 7)) stop("The weekly archive contains a date gap", call. = FALSE)
  data.table(path = files, week_start = dates)
}

load_county_lookup <- function(path) {
  if (!file.exists(path)) {
    stop(
      "County labels were not found. Supply the existing atlas JSON with --labels=PATH.",
      call. = FALSE
    )
  }
  prior <- fromJSON(path, simplifyDataFrame = TRUE)
  if (is.null(prior$counties) || !all(c("fips", "state", "county") %in% names(prior$counties))) {
    stop("The label JSON does not contain county fips/state/county fields", call. = FALSE)
  }
  lookup <- as.data.table(prior$counties)[, .(
    fips = as.character(fips),
    state = as.character(state),
    county = as.character(county)
  )]
  # The NYT case archive combines New York City's boroughs and several Alaska
  # county equivalents. Kang uses their official five-digit county GEOIDs, so
  # replace the three display-only aggregates with the ten source geographies.
  lookup <- lookup[
    grepl("^[0-9]{5}$", fips) & !fips %chin% c("02997", "02998")
  ]
  lookup <- rbind(
    lookup,
    data.table(
      fips = c(
        "02060", "02105", "02158", "02164", "02282",
        "36005", "36047", "36061", "36081", "36085"
      ),
      state = c(rep("Alaska", 5), rep("New York", 5)),
      county = c(
        "Bristol Bay Borough", "Hoonah-Angoon Census Area", "Kusilvak Census Area",
        "Lake and Peninsula Borough", "Yakutat City and Borough",
        "Bronx", "Kings", "New York", "Queens", "Richmond"
      )
    ),
    use.names = TRUE
  )
  lookup <- unique(lookup, by = "fips")
  if (nrow(lookup) != 3142L || uniqueN(lookup$state) != 51L) {
    stop("Expected 3,142 Kang county geographies across 50 states plus D.C.", call. = FALSE)
  }
  setkey(lookup, fips)
  lookup
}

load_geometry_order <- function(path, county_lookup) {
  if (!file.exists(path)) {
    stop("County map metadata was not found: ", path, call. = FALSE)
  }
  metadata <- fromJSON(path, simplifyDataFrame = TRUE)
  counties <- as.data.table(metadata$geometry$counties)
  if (!"fips" %in% names(counties) || nrow(counties) != nrow(county_lookup)) {
    stop("County map metadata does not contain the expected 3,142 county GEOIDs", call. = FALSE)
  }
  order <- as.character(counties$fips)
  if (uniqueN(order) != length(order) || !setequal(order, county_lookup$fips)) {
    stop("County map GEOIDs do not match the Kang county lookup", call. = FALSE)
  }
  list(fips = order, build_id = as.character(metadata$buildId))
}

read_week <- function(repo, path) {
  object <- paste0("HEAD:", path)
  command <- paste(
    "git",
    paste0("--git-dir=", shQuote(repo)),
    "show",
    shQuote(object)
  )
  fread(
    cmd = command,
    select = c("geoid_o", "geoid_d", "date_range", "visitor_flows"),
    colClasses = list(character = c("geoid_o", "geoid_d", "date_range")),
    showProgress = FALSE
  )
}

build_archive <- function(
  repo,
  output,
  labels,
  dynamics,
  binary,
  state_pair_binary,
  geometry
) {
  weeks <- discover_week_files(repo)
  county_lookup <- load_county_lookup(labels)
  geometry_order <- load_geometry_order(geometry, county_lookup)
  state_by_fips <- setNames(county_lookup$state, substr(county_lookup$fips, 1, 2))
  state_by_fips <- state_by_fips[!duplicated(names(state_by_fips))]
  allowed_counties <- county_lookup$fips

  county_out_parts <- vector("list", nrow(weeks))
  county_in_parts <- vector("list", nrow(weeks))
  intrastate_parts <- vector("list", nrow(weeks))
  interstate_in_parts <- vector("list", nrow(weeks))
  interstate_out_parts <- vector("list", nrow(weeks))
  directed_parts <- vector("list", nrow(weeks))
  pair_parts <- vector("list", nrow(weeks))
  pulse_parts <- vector("list", nrow(weeks))
  county_in_weekly <- matrix(0, nrow = nrow(weeks), ncol = length(geometry_order$fips))
  county_out_weekly <- matrix(0, nrow = nrow(weeks), ncol = length(geometry_order$fips))

  row_count <- valid_row_count <- malformed_rows <- excluded_non_atlas_rows <- 0
  negative_value_rows <- zero_value_rows <- duplicate_pairs <- 0
  total_observed <- intracounty_observed <- 0
  intrastate_observed <- interstate_observed <- 0
  date_range_conflicts <- 0L
  coverage_start <- as.Date(NA)
  coverage_end <- as.Date(NA)

  for (i in seq_len(nrow(weeks))) {
    week <- read_week(repo, weeks$path[i])
    row_count <- row_count + nrow(week)
    week_end <- weeks$week_start[i] + 6L

    ranges <- unique(week$date_range[!is.na(week$date_range)])
    if (length(ranges) != 1L) {
      date_range_conflicts <- date_range_conflicts + 1L
    } else {
      bounds <- strsplit(ranges, " - ", fixed = TRUE)[[1]]
      parsed <- as.Date(bounds, format = "%m/%d/%y")
      if (length(parsed) != 2L || anyNA(parsed) || parsed[1] != weeks$week_start[i]) {
        date_range_conflicts <- date_range_conflicts + 1L
      } else {
        week_end <- parsed[2]
        if (is.na(coverage_start) || parsed[1] < coverage_start) coverage_start <- parsed[1]
        if (is.na(coverage_end) || parsed[2] > coverage_end) coverage_end <- parsed[2]
      }
    }

    malformed <- is.na(week$geoid_o) | is.na(week$geoid_d) |
      !grepl("^[0-9]{5}$", week$geoid_o) | !grepl("^[0-9]{5}$", week$geoid_d) |
      is.na(week$visitor_flows) | !is.finite(week$visitor_flows)
    malformed_rows <- malformed_rows + sum(malformed)
    week <- week[!malformed]

    negative_value_rows <- negative_value_rows + week[visitor_flows < 0, .N]
    zero_value_rows <- zero_value_rows + week[visitor_flows == 0, .N]
    week <- week[visitor_flows >= 0]

    non_atlas <- !(week$geoid_o %chin% allowed_counties) |
      !(week$geoid_d %chin% allowed_counties)
    excluded_non_atlas_rows <- excluded_non_atlas_rows + sum(non_atlas)
    week <- week[!non_atlas]
    valid_row_count <- valid_row_count + nrow(week)
    duplicate_pairs <- duplicate_pairs + nrow(week) - uniqueN(week, by = c("geoid_o", "geoid_d"))

    week_total_observed <- sum(week$visitor_flows)
    total_observed <- total_observed + week_total_observed
    same_county <- week$geoid_o == week$geoid_d
    week_intracounty_observed <- sum(week$visitor_flows[same_county])
    intracounty_observed <- intracounty_observed + week_intracounty_observed
    cross <- week[!same_county]
    cross[, `:=`(
      state_o = unname(state_by_fips[substr(geoid_o, 1, 2)]),
      state_d = unname(state_by_fips[substr(geoid_d, 1, 2)])
    )]

    week_county_out <- cross[, .(value = sum(visitor_flows)), by = .(fips = geoid_o)]
    week_county_in <- cross[, .(value = sum(visitor_flows)), by = .(fips = geoid_d)]
    county_out_parts[[i]] <- week_county_out
    county_in_parts[[i]] <- week_county_in
    county_out_weekly[i, match(week_county_out$fips, geometry_order$fips)] <- week_county_out$value
    county_in_weekly[i, match(week_county_in$fips, geometry_order$fips)] <- week_county_in$value

    same_state <- cross$state_o == cross$state_d
    intrastate <- cross[same_state]
    interstate <- cross[!same_state]
    week_intrastate_observed <- sum(intrastate$visitor_flows)
    week_interstate_observed <- sum(interstate$visitor_flows)
    intrastate_observed <- intrastate_observed + week_intrastate_observed
    interstate_observed <- interstate_observed + week_interstate_observed

    pulse_parts[[i]] <- data.table(
      weekStart = format(weeks$week_start[i], "%Y-%m-%d"),
      weekEnd = format(week_end, "%Y-%m-%d"),
      totalObserved = week_total_observed,
      withinCountyObserved = week_intracounty_observed,
      intrastateCrossCountyObserved = week_intrastate_observed,
      interstateObserved = week_interstate_observed,
      crossCountyObserved = week_intrastate_observed + week_interstate_observed
    )

    intrastate_parts[[i]] <- intrastate[, .(value = sum(visitor_flows)), by = .(state = state_o)]
    interstate_out_parts[[i]] <- interstate[, .(value = sum(visitor_flows)), by = .(state = state_o)]
    interstate_in_parts[[i]] <- interstate[, .(value = sum(visitor_flows)), by = .(state = state_d)]
    directed_parts[[i]] <- interstate[, .(value = sum(visitor_flows)), by = .(
      source = state_o,
      target = state_d
    )]
    pair_parts[[i]] <- interstate[, .(value = sum(visitor_flows)), by = .(
      source = pmin(state_o, state_d),
      target = pmax(state_o, state_d)
    )]

    if (i == 1L || i %% 10L == 0L || i == nrow(weeks)) {
      message(sprintf("Processed %3d/%d weeks through %s", i, nrow(weeks), coverage_end))
    }
    rm(week, cross, intrastate, interstate)
  }

  sum_one_key <- function(parts, key) {
    rbindlist(parts, use.names = TRUE)[, .(value = sum(value)), by = key]
  }
  county_out <- sum_one_key(county_out_parts, "fips")
  county_in <- sum_one_key(county_in_parts, "fips")
  state_intrastate <- sum_one_key(intrastate_parts, "state")
  state_interstate_in <- sum_one_key(interstate_in_parts, "state")
  state_interstate_out <- sum_one_key(interstate_out_parts, "state")
  directed <- rbindlist(directed_parts)[, .(value = sum(value)), by = .(source, target)]
  pairs <- rbindlist(pair_parts)[, .(value = sum(value)), by = .(source, target)]
  pulse <- rbindlist(pulse_parts, use.names = TRUE)
  pulse[, seasonalWeek := ((seq_len(.N) - 1L) %% 52L) + 1L]
  baseline_total <- pulse$totalObserved[seq_len(52L)]
  baseline_within <- pulse$withinCountyObserved[seq_len(52L)]
  baseline_cross <- pulse$crossCountyObserved[seq_len(52L)]
  pulse[, `:=`(
    totalIndex = round(totalObserved / baseline_total[seasonalWeek] * 100, 1),
    withinCountyIndex = round(withinCountyObserved / baseline_within[seasonalWeek] * 100, 1),
    crossCountyIndex = round(crossCountyObserved / baseline_cross[seasonalWeek] * 100, 1)
  )]

  absolute_balance <- abs(county_in_weekly - county_out_weekly)
  nonzero_balance <- absolute_balance[absolute_balance > 0]
  balance_cap <- as.numeric(quantile(nonzero_balance, 0.995, names = FALSE, type = 7))
  inbound_values <- as.vector(t(county_in_weekly))
  outbound_values <- as.vector(t(county_out_weekly))
  if (max(c(inbound_values, outbound_values)) > .Machine$integer.max) {
    stop("A weekly county flow exceeds the UInt32-compatible atlas range", call. = FALSE)
  }
  binary_values <- integer(length(inbound_values) * 2L)
  binary_values[seq.int(1L, length(binary_values), by = 2L)] <- as.integer(round(inbound_values))
  binary_values[seq.int(2L, length(binary_values), by = 2L)] <- as.integer(round(outbound_values))
  binary_header <- charToRaw("KANGWEEKLYFLOW01")
  binary_build_id <- paste(sprintf("%02x", as.integer(binary_header)), collapse = "")

  if (!isTRUE(all.equal(sum(inbound_values), intrastate_observed + interstate_observed)) ||
      !isTRUE(all.equal(sum(outbound_values), intrastate_observed + interstate_observed))) {
    stop("Weekly county flow totals do not reconcile with the archive aggregate", call. = FALSE)
  }

  counties <- copy(county_lookup)
  counties[county_in, inbound := i.value, on = "fips"]
  counties[county_out, outbound := i.value, on = "fips"]
  counties[is.na(inbound), inbound := 0]
  counties[is.na(outbound), outbound := 0]
  counties[, `:=`(total = inbound + outbound, balance = inbound - outbound)]
  setorder(counties, -total, fips)

  state_names <- sort(unique(county_lookup$state))
  states <- data.table(state = state_names)
  states[state_interstate_in, interstateIn := i.value, on = "state"]
  states[state_interstate_out, interstateOut := i.value, on = "state"]
  states[state_intrastate, intrastateCrossCounty := i.value, on = "state"]
  for (column in c("interstateIn", "interstateOut", "intrastateCrossCounty")) {
    set(states, which(is.na(states[[column]])), column, 0)
  }
  states[, interstateTotal := interstateIn + interstateOut]
  setcolorder(states, c(
    "state", "interstateIn", "interstateOut", "interstateTotal", "intrastateCrossCounty"
  ))
  setorder(directed, -value, source, target)
  setorder(pairs, -value, source, target)

  pair_keys <- paste(pairs$source, pairs$target, sep = "\u001f")
  state_pair_weekly <- matrix(0, nrow = nrow(weeks), ncol = nrow(pairs))
  for (i in seq_len(nrow(weeks))) {
    week_pairs <- pair_parts[[i]]
    week_keys <- paste(week_pairs$source, week_pairs$target, sep = "\u001f")
    pair_indices <- match(week_keys, pair_keys)
    if (anyNA(pair_indices)) {
      stop("A weekly interstate pair is absent from the archive pair order", call. = FALSE)
    }
    state_pair_weekly[i, pair_indices] <- week_pairs$value
  }
  state_pair_values <- as.vector(t(state_pair_weekly))
  if (max(state_pair_values) > .Machine$integer.max) {
    stop("A weekly interstate pair exceeds the UInt32-compatible atlas range", call. = FALSE)
  }
  if (!isTRUE(all.equal(rowSums(state_pair_weekly), pulse$interstateObserved))) {
    stop("Weekly interstate pair totals do not reconcile with the archive pulse", call. = FALSE)
  }
  if (!isTRUE(all.equal(colSums(state_pair_weekly), pairs$value))) {
    stop("Weekly interstate pair totals do not reconcile with the archive network", call. = FALSE)
  }
  if (!isTRUE(all.equal(sum(state_pair_weekly), interstate_observed))) {
    stop("Weekly interstate pair totals do not reconcile with the archive total", call. = FALSE)
  }

  result <- list(
    meta = list(
      source = "Kang weekly county mobility flows",
      sourceRepository = SOURCE_REPOSITORY,
      sourceFileCount = nrow(weeks),
      coverageStart = format(coverage_start, "%Y-%m-%d"),
      coverageEnd = format(coverage_end, "%Y-%m-%d"),
      grain = "weekly county origin-destination observations aggregated over the full archive",
      unit = "cumulative detected visitor observations; not unique individuals",
      metric = "visitor_flows",
      rowCount = row_count,
      validRowCount = valid_row_count,
      countyCount = nrow(county_lookup),
      stateCount = length(state_names),
      totalObserved = total_observed,
      intracountyObserved = intracounty_observed,
      intrastateCrossCountyObserved = intrastate_observed,
      interstateObserved = interstate_observed
    ),
    quality = list(
      malformedRows = malformed_rows,
      negativeValueRows = negative_value_rows,
      zeroValueRows = zero_value_rows,
      excludedNonAtlasRows = excluded_non_atlas_rows,
      duplicatePairsWithinSourceFile = duplicate_pairs,
      dateRangeConflicts = date_range_conflicts,
      sourceWeekGaps = sum(diff(weeks$week_start) != 7),
      duplicatePairsWithinOrigin = 0,
      originBlockReentries = 0,
      countyLabelConflicts = 0,
      originCountyCount = uniqueN(county_out$fips),
      destinationCountyCount = uniqueN(county_in$fips)
    ),
    states = states,
    stateFlows = directed,
    statePairs = pairs,
    counties = counties
  )

  if (result$meta$coverageStart != "2019-01-07" || result$meta$coverageEnd != "2022-01-02") {
    stop("Unexpected date_range coverage in the source files", call. = FALSE)
  }
  if (result$quality$dateRangeConflicts != 0L || result$quality$sourceWeekGaps != 0L) {
    stop("Weekly date validation failed", call. = FALSE)
  }
  if (result$quality$malformedRows != 0 || result$quality$negativeValueRows != 0) {
    stop("Malformed or negative mobility records were found", call. = FALSE)
  }
  if (nrow(pairs) != choose(length(state_names), 2)) {
    stop("Expected a complete 51-state undirected network", call. = FALSE)
  }

  dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
  write_json(result, output, auto_unbox = TRUE, digits = NA, pretty = FALSE, na = "null")
  message("Wrote ", normalizePath(output, mustWork = TRUE))

  dir.create(dirname(binary), recursive = TRUE, showWarnings = FALSE)
  binary_connection <- file(binary, open = "wb")
  on.exit(close(binary_connection), add = TRUE)
  writeBin(binary_header, binary_connection)
  writeBin(binary_values, binary_connection, size = 4L, endian = "little")
  close(binary_connection)
  on.exit(NULL, add = FALSE)

  state_pair_binary_header <- charToRaw("KANGSTATEPAIR001")
  state_pair_binary_build_id <- paste(
    sprintf("%02x", as.integer(state_pair_binary_header)),
    collapse = ""
  )
  dir.create(dirname(state_pair_binary), recursive = TRUE, showWarnings = FALSE)
  state_pair_connection <- file(state_pair_binary, open = "wb")
  on.exit(close(state_pair_connection), add = TRUE)
  writeBin(state_pair_binary_header, state_pair_connection)
  writeBin(
    as.integer(round(state_pair_values)),
    state_pair_connection,
    size = 4L,
    endian = "little"
  )
  close(state_pair_connection)
  on.exit(NULL, add = FALSE)

  dynamics_result <- list(
    version = 1L,
    buildId = binary_build_id,
    binaryHeaderBytes = length(binary_header),
    binaryBytes = as.numeric(file.info(binary)$size),
    fieldCount = 2L,
    fields = c("inbound", "outbound"),
    layout = "week-major, then county map order, then inbound/outbound UInt32 little-endian",
    weekCount = nrow(pulse),
    countyCount = length(geometry_order$fips),
    coverageStart = format(coverage_start, "%Y-%m-%d"),
    coverageEnd = format(coverage_end, "%Y-%m-%d"),
    geometryBuildId = geometry_order$build_id,
    balanceCap = balance_cap,
    pulseBaseline = "Each week is indexed to the corresponding ordinal week in the 52-week 2019 archive; 2019 = 100.",
    pulse = pulse,
    statePairArchive = list(
      version = 1L,
      url = "/data/mobility-state-pairs.bin",
      buildId = state_pair_binary_build_id,
      binaryHeaderBytes = length(state_pair_binary_header),
      binaryBytes = as.numeric(file.info(state_pair_binary)$size),
      fieldCount = 1L,
      fields = c("twoWayInterstateObserved"),
      layout = "week-major, then mobility.json statePairs order, UInt32 little-endian",
      weekCount = nrow(pulse),
      pairCount = nrow(pairs),
      pairOrder = "mobility.json statePairs archive-wide descending order",
      methodology = "Each cell sums both directed visitor_flows records for one interstate state pair in one week."
    ),
    methodology = list(
      countyFields = "Weekly inbound and outbound cross-county detected visitor observations; within-county observations are excluded.",
      balance = "Net balance equals inbound minus outbound. Map color uses a signed log scale capped at the archive-wide 99.5th percentile of absolute weekly county balance.",
      caveat = "Movement observations are not unique individuals and do not identify transportation mode. Associations with reported incidence are descriptive, not causal."
    ),
    sources = list(
      repository = SOURCE_REPOSITORY,
      methodology = "https://github.com/GeoDS/COVID19USFlows-WeeklyFlows/blob/master/README.md"
    )
  )
  expected_binary_bytes <- length(binary_header) + length(binary_values) * 4
  if (dynamics_result$binaryBytes != expected_binary_bytes) {
    stop("Weekly mobility binary size validation failed", call. = FALSE)
  }
  expected_state_pair_bytes <- length(state_pair_binary_header) + length(state_pair_values) * 4
  if (dynamics_result$statePairArchive$binaryBytes != expected_state_pair_bytes) {
    stop("Weekly interstate pair binary size validation failed", call. = FALSE)
  }
  dir.create(dirname(dynamics), recursive = TRUE, showWarnings = FALSE)
  write_json(
    dynamics_result,
    dynamics,
    auto_unbox = TRUE,
    digits = NA,
    pretty = FALSE,
    na = "null"
  )
  message("Wrote ", normalizePath(dynamics, mustWork = TRUE))
  message("Wrote ", normalizePath(binary, mustWork = TRUE))
  message("Wrote ", normalizePath(state_pair_binary, mustWork = TRUE))
  invisible(result)
}

args <- parse_args(commandArgs(trailingOnly = TRUE))
repo <- ensure_source_repo(args$repo)
profile <- build_archive(
  repo,
  args$output,
  args$labels,
  args$dynamics,
  args$binary,
  args$state_pair_binary,
  args$geometry
)
cat(toJSON(list(meta = profile$meta, quality = profile$quality), auto_unbox = TRUE, pretty = TRUE), "\n")
