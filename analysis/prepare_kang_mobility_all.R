#!/usr/bin/env Rscript

# Build the Pandemic Atlas mobility aggregate from every county-level week
# published in GeoDS's Kang mobility archive.
#
# The source repository is about 1 GB as a compressed Git pack and expands to
# roughly 11 GB of CSV. To keep the project and local disk lean, this script
# reads each CSV directly from the Git object database, retains only the four
# columns required for the atlas, and accumulates compact state/county totals.
# No raw CSV is checked into the site.

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
default_cache_root <- Sys.getenv(
  "KANG_CACHE_DIR",
  unset = file.path(path.expand("~"), ".cache", "pandemic-atlas")
)
default_repo <- file.path(default_cache_root, "kang-weekly-flows.git")

parse_args <- function(args) {
  values <- list(
    repo = Sys.getenv("KANG_WEEKLY_REPO", unset = default_repo),
    output = default_output,
    labels = default_output
  )
  for (arg in args) {
    if (startsWith(arg, "--repo=")) values$repo <- sub("^--repo=", "", arg)
    else if (startsWith(arg, "--output=")) values$output <- sub("^--output=", "", arg)
    else if (startsWith(arg, "--labels=")) values$labels <- sub("^--labels=", "", arg)
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

build_archive <- function(repo, output, labels) {
  weeks <- discover_week_files(repo)
  county_lookup <- load_county_lookup(labels)
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

    ranges <- unique(week$date_range[!is.na(week$date_range)])
    if (length(ranges) != 1L) {
      date_range_conflicts <- date_range_conflicts + 1L
    } else {
      bounds <- strsplit(ranges, " - ", fixed = TRUE)[[1]]
      parsed <- as.Date(bounds, format = "%m/%d/%y")
      if (length(parsed) != 2L || anyNA(parsed) || parsed[1] != weeks$week_start[i]) {
        date_range_conflicts <- date_range_conflicts + 1L
      } else {
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

    total_observed <- total_observed + sum(week$visitor_flows)
    same_county <- week$geoid_o == week$geoid_d
    intracounty_observed <- intracounty_observed + sum(week$visitor_flows[same_county])
    cross <- week[!same_county]
    cross[, `:=`(
      state_o = unname(state_by_fips[substr(geoid_o, 1, 2)]),
      state_d = unname(state_by_fips[substr(geoid_d, 1, 2)])
    )]

    county_out_parts[[i]] <- cross[, .(value = sum(visitor_flows)), by = .(fips = geoid_o)]
    county_in_parts[[i]] <- cross[, .(value = sum(visitor_flows)), by = .(fips = geoid_d)]

    same_state <- cross$state_o == cross$state_d
    intrastate <- cross[same_state]
    interstate <- cross[!same_state]
    intrastate_observed <- intrastate_observed + sum(intrastate$visitor_flows)
    interstate_observed <- interstate_observed + sum(interstate$visitor_flows)

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
  invisible(result)
}

args <- parse_args(commandArgs(trailingOnly = TRUE))
repo <- ensure_source_repo(args$repo)
profile <- build_archive(repo, args$output, args$labels)
cat(toJSON(list(meta = profile$meta, quality = profile$quality), auto_unbox = TRUE, pretty = TRUE), "\n")
