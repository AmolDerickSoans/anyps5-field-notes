#!/usr/bin/env python3
"""Collect public GitHub metrics for boykopovar/AnyPS5.

Uses the GitHub CLI's active credential when available; otherwise uses the
unauthenticated public REST API. Raw API bodies and sanitized provenance are
stored beside metrics.json. No credential is written to disk or printed.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research" / "metrics"
RAW = OUT / "raw"
OWNER, REPO = "boykopovar", "AnyPS5"
API = "https://api.github.com"
PER_PAGE = 100
WORKERS = 8


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def auth_token() -> str | None:
    try:
        p = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True)
        return p.stdout.strip() or None
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


TOKEN = auth_token()
RATE = {"remaining": None, "limit": None, "used": None, "reset": None}
RATE_LOCK = __import__("threading").Lock()
PROVENANCE: list[dict] = []


def safe_slug(path: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", path.strip("/")) or "root"


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def request(path: str, *, params: dict | None = None, accept: str = "application/vnd.github+json",
            raw_name: str | None = None) -> tuple[object, dict]:
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "anyps5-story-metrics-collector",
    }
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    req = urllib.request.Request(url, headers=headers)
    last_error = None
    for attempt in range(5):
        retrieved = utc_now()
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                parsed = json.loads(body)
                response_headers = {k.lower(): v for k, v in resp.headers.items()}
                safe_headers = {
                    k: response_headers[k] for k in
                    ("date", "etag", "last-modified", "link", "x-ratelimit-limit",
                     "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-used")
                    if k in response_headers
                }
                with RATE_LOCK:
                    for header, key in (("x-ratelimit-remaining", "remaining"),
                                        ("x-ratelimit-limit", "limit"),
                                        ("x-ratelimit-used", "used"),
                                        ("x-ratelimit-reset", "reset")):
                        if header in response_headers:
                            try:
                                val = int(response_headers[header])
                                if key == "remaining" and RATE[key] is not None:
                                    RATE[key] = min(RATE[key], val)
                                else:
                                    RATE[key] = val
                            except ValueError:
                                pass
                record = {
                    "path": path,
                    "url": url,
                    "retrieved_at_utc": retrieved,
                    "http_status": resp.status,
                    "response_headers": safe_headers,
                }
                if raw_name:
                    save_json(RAW / raw_name, parsed)
                return parsed, record
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code} for {path}"
            if exc.code in (403, 429):
                wait = int(exc.headers.get("Retry-After", "0") or 0)
                reset = exc.headers.get("X-RateLimit-Reset")
                if wait <= 0 and reset:
                    wait = max(1, int(reset) - int(time.time()) + 2)
                if wait > 0 and attempt < 4:
                    time.sleep(min(wait, 90))
                    continue
            try:
                detail = json.loads(exc.read().decode("utf-8", "replace"))
                last_error += ": " + str(detail.get("message", ""))
            except Exception:
                pass
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = f"{type(exc).__name__} for {path}"
            if attempt < 4:
                time.sleep(1 + attempt * 2)
                continue
            break
    raise RuntimeError(last_error or f"request failed for {path}")


def link_last_page(link: str | None) -> int | None:
    if not link:
        return None
    for part in link.split(","):
        if 'rel="last"' not in part:
            continue
        m = re.search(r"[?&]page=(\d+)", part)
        if m:
            return int(m.group(1))
    return None


def get_pages(path: str, label: str, *, params: dict | None = None,
              accept: str = "application/vnd.github+json") -> list:
    base_params = {"per_page": PER_PAGE, **(params or {})}
    first, meta = request(path, params={**base_params, "page": 1}, accept=accept,
                          raw_name=f"{label}/page-0001.json")
    PROVENANCE.append(meta)
    if not isinstance(first, list) or not first:
        return first if isinstance(first, list) else []
    last = link_last_page(meta.get("response_headers", {}).get("link")) or 1
    pages: dict[int, list] = {1: first}
    if last > 1:
        def fetch(page: int):
            value, record = request(path, params={**base_params, "page": page}, accept=accept,
                                    raw_name=f"{label}/page-{page:04d}.json")
            return page, value, record
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(fetch, page) for page in range(2, last + 1)]
            for future in concurrent.futures.as_completed(futures):
                page, value, record = future.result()
                pages[page] = value
                PROVENANCE.append(record)
    return [item for page in range(1, last + 1) for item in pages.get(page, [])]


def utc_day(iso: str) -> str:
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(dt.timezone.utc).date().isoformat()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    started = utc_now()
    repo_path = f"/repos/{OWNER}/{REPO}"
    repository, meta = request(repo_path, raw_name="repository.json")
    PROVENANCE.append(meta)
    repository_meta = meta
    if repository.get("full_name", "").lower() != f"{OWNER}/{REPO}".lower():
        raise RuntimeError("GitHub returned an unexpected repository")

    # Read-only summary endpoints.
    languages, meta = request(repo_path + "/languages", raw_name="languages.json")
    PROVENANCE.append(meta)
    open_issue_search, meta = request("/search/issues", params={"q": f"repo:{OWNER}/{REPO} is:issue is:open", "per_page": 1},
                                      raw_name="open-issues-search.json")
    PROVENANCE.append(meta)
    releases = get_pages(repo_path + "/releases", "releases")
    contributors = get_pages(repo_path + "/contributors", "contributors", params={"anon": "1"})

    # Establish exact commit pagination count, then collect every reachable
    # commit on the default branch for a daily author-date activity series.
    branch = repository["default_branch"]
    commits_path = repo_path + "/commits"
    first_commits, meta = request(commits_path, params={"sha": branch, "per_page": PER_PAGE, "page": 1},
                                  raw_name="commits/page-0001.json")
    PROVENANCE.append(meta)
    last_commit_page = link_last_page(meta.get("response_headers", {}).get("link")) or (1 if first_commits else 0)
    commit_pages = {1: first_commits} if first_commits else {}
    if last_commit_page > 1:
        def fetch_commit(page: int):
            value, record = request(commits_path, params={"sha": branch, "per_page": PER_PAGE, "page": page},
                                    raw_name=f"commits/page-{page:04d}.json")
            return page, value, record
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = [pool.submit(fetch_commit, page) for page in range(2, last_commit_page + 1)]
            for future in concurrent.futures.as_completed(futures):
                page, value, record = future.result()
                commit_pages[page] = value
                PROVENANCE.append(record)
    commits = [c for page in range(1, last_commit_page + 1) for c in commit_pages.get(page, [])]

    # GitHub's star media type returns historical event timestamps, but as of
    # July 2026 listing stargazers is restricted to repository admins and
    # collaborators. Preserve a failed endpoint result as unavailable data.
    star_history_error = None
    try:
        stars = get_pages(repo_path + "/stargazers", "stargazers",
                          accept="application/vnd.github.star+json")
    except RuntimeError as exc:
        star_history_error = str(exc)
        stars = []
        save_json(RAW / "stargazers" / "error.json", {
            "endpoint": repo_path + "/stargazers",
            "http_error": star_history_error,
            "note": "GitHub restricted this listing endpoint to repository admins and collaborators in July 2026.",
        })
        PROVENANCE.append({
            "path": repo_path + "/stargazers",
            "url": API + repo_path + "/stargazers",
            "retrieved_at_utc": utc_now(),
            "http_status": 404,
            "error": star_history_error,
        })

    graphql_probe = None
    graphql_probe_at = utc_now()
    graphql_query = (
        'query { repository(owner: "boykopovar", name: "AnyPS5") { stargazerCount '
        'recent: stargazers(first: 1) { edges { starredAt } pageInfo { endCursor hasNextPage } } '
        'earliest: stargazers(first: 1, orderBy: {field: STARRED_AT, direction: ASC}) '
        '{ edges { starredAt } pageInfo { endCursor hasNextPage } } '
        'latest: stargazers(first: 1, orderBy: {field: STARRED_AT, direction: DESC}) '
        '{ edges { starredAt } pageInfo { endCursor hasNextPage } } } }'
    )
    try:
        if not TOKEN:
            raise RuntimeError("GitHub GraphQL API requires authentication")
        gql_req = urllib.request.Request(
            "https://api.github.com/graphql",
            data=json.dumps({"query": graphql_query}).encode("utf-8"),
            headers={"Accept": "application/vnd.github+json", "Content-Type": "application/json",
                     "Authorization": "Bearer " + TOKEN, "User-Agent": "anyps5-story-metrics-collector"},
            method="POST",
        )
        with urllib.request.urlopen(gql_req, timeout=60) as resp:
            graphql_probe = json.loads(resp.read())
            save_json(RAW / "graphql-star-probes.json", {
                "query": graphql_query, "retrieved_at_utc": graphql_probe_at,
                "responses": [graphql_probe],
            })
            PROVENANCE.append({"path": "/graphql", "url": "https://api.github.com/graphql",
                               "retrieved_at_utc": graphql_probe_at, "http_status": resp.status,
                               "raw_response": "raw/graphql-star-probes.json"})
    except Exception as exc:
        graphql_probe = {"error": f"{type(exc).__name__}: GraphQL star probe failed"}
        save_json(RAW / "graphql-star-probes.json", {
            "query": graphql_query, "retrieved_at_utc": graphql_probe_at,
            "error": graphql_probe["error"],
        })

    commit_days = Counter()
    for commit in commits:
        authored = (commit.get("commit", {}).get("author") or {}).get("date")
        if authored:
            commit_days[utc_day(authored)] += 1
    star_days = Counter()
    undated_stars = 0
    for star in stars:
        starred_at = star.get("starred_at") if isinstance(star, dict) else None
        if starred_at:
            star_days[utc_day(starred_at)] += 1
        else:
            undated_stars += 1

    cumulative = 0
    star_timeline = []
    for day in sorted(star_days):
        daily = star_days[day]
        cumulative += daily
        star_timeline.append({"date": day, "daily_stars": daily, "cumulative_stars_in_returned_history": cumulative})
    commit_timeline = [{"date": day, "commits": commit_days[day]} for day in sorted(commit_days)]

    owner_login = repository.get("owner", {}).get("login", OWNER)
    author_days: dict[str, dict] = {}
    first_author_day: dict[str, str] = {}
    bot_logins: set[str] = set()
    for commit in commits:
        account = commit.get("author") or {}
        login = account.get("login")
        is_bot = bool(login and ((account.get("type") or "").lower() == "bot" or login.lower().endswith("[bot]")))
        stamp = ((commit.get("commit", {}).get("author") or {}).get("date"))
        if not stamp:
            continue
        day = utc_day(stamp)
        row = author_days.setdefault(day, {"owner": 0, "other_linked": 0, "bot": 0, "unlinked": 0,
                                           "linked_logins": set(), "human_logins": set()})
        if is_bot:
            row["bot"] += 1
            bot_logins.add(login)
        elif not login:
            row["unlinked"] += 1
        elif login.lower() == owner_login.lower():
            row["owner"] += 1
        else:
            row["other_linked"] += 1
        if login:
            row["linked_logins"].add(login)
            first_author_day[login] = min(day, first_author_day.get(login, day))
            if not is_bot:
                row["human_logins"].add(login)
    author_timeline = []
    cumulative_logins: set[str] = set()
    cumulative_humans: set[str] = set()
    for day in sorted(author_days):
        row = author_days[day]
        first_seen_today = {login for login, first_day in first_author_day.items() if first_day == day}
        cumulative_logins.update(first_seen_today)
        cumulative_humans.update(first_seen_today - bot_logins)
        author_timeline.append({
            "date": day,
            "commits": sum(row[k] for k in ("owner", "other_linked", "bot", "unlinked")),
            "daily_unique_linked_author_logins": len(row["linked_logins"]),
            "daily_unique_human_author_logins": len(row["human_logins"]),
            "cumulative_unique_linked_author_logins": len(cumulative_logins),
            "cumulative_unique_human_author_logins": len(cumulative_humans),
            "commit_attribution": {k: row[k] for k in ("owner", "other_linked", "bot", "unlinked")},
        })

    non_anonymous = {c.get("login") for c in contributors if c.get("login")}
    anonymous_keys = set()
    for c in contributors:
        if not c.get("login"):
            # Anonymous rows provide author name/email on GitHub's endpoint.
            author = c.get("author") or {}
            key = (author.get("name"), author.get("email"))
            anonymous_keys.add(key)
    earliest_commit = commits[-1] if commits else None
    earliest_commit_date = None
    if earliest_commit:
        earliest_commit_date = ((earliest_commit.get("commit", {}).get("author") or {}).get("date"))
    created_at = repository.get("created_at")
    retrieved = utc_now()
    total_history_stars = len(stars)
    result = {
        "schema_version": 1,
        "repository": {
            "full_name": repository.get("full_name"),
            "html_url": repository.get("html_url"),
            "description": repository.get("description"),
            "created_at_utc": created_at,
            "updated_at_utc": repository.get("updated_at"),
            "pushed_at_utc": repository.get("pushed_at"),
            "default_branch": branch,
            "visibility": repository.get("visibility"),
        },
        "snapshot_at_utc": repository_meta["retrieved_at_utc"],
        "snapshot_counts": {
            "stars": repository.get("stargazers_count"),
            "forks": repository.get("forks_count"),
            "watchers": repository.get("subscribers_count"),
            "open_issues_including_pull_requests": repository.get("open_issues_count"),
            "open_issues_only": open_issue_search.get("total_count"),
        },
        "languages_bytes": languages,
        "release_count": len(releases),
        "releases": [{"tag_name": r.get("tag_name"), "name": r.get("name"),
                      "published_at_utc": r.get("published_at"), "html_url": r.get("html_url"),
                      "draft": r.get("draft"), "prerelease": r.get("prerelease")} for r in releases],
        "contributors": {
            "endpoint": f"GET {repo_path}/contributors?anon=1",
            "returned_rows": len(contributors),
            "identified_accounts": len(non_anonymous),
            "anonymous_author_identities": len(anonymous_keys),
            "unique_endpoint_identities": len(non_anonymous) + len(anonymous_keys),
            "attribution_note": "GitHub contributors endpoint attributes contributors from repository commits, returns ranked/paginated entries, and may omit users who hide their contribution graph; anon=1 includes anonymous commit authors. These are commit-attributed contributors, not all users who interacted with the repository.",
        },
        "default_branch_commits": {
            "branch": branch,
            "count_from_rest_pagination": len(commits),
            "pages_collected": last_commit_page,
            "per_page": PER_PAGE,
            "earliest_reachable_commit_author_date_utc": earliest_commit_date,
            "earliest_reachable_commit_sha": earliest_commit.get("sha") if earliest_commit else None,
            "date_basis": "commit.commit.author.date; this is author timestamp, not repository creation time or necessarily committer timestamp",
        },
        "star_history": {
            "endpoint": f"GET {repo_path}/stargazers",
            "accept": "application/vnd.github.star+json",
            "available": star_history_error is None,
            "unavailable_reason": star_history_error,
            "returned_stargazers": total_history_stars if star_history_error is None else None,
            "api_snapshot_stars": repository.get("stargazers_count"),
            "complete_for_current_stargazers": star_history_error is None and total_history_stars == repository.get("stargazers_count") and undated_stars == 0,
            "undated_records": undated_stars,
            "date_basis": "starred_at UTC event timestamp",
            "graphql_probe": {
                "retrieved_at_utc": graphql_probe_at,
                "stargazer_count": (((graphql_probe or {}).get("data") or {}).get("repository") or {}).get("stargazerCount"),
                "edges_returned": sum(len(((((graphql_probe or {}).get("data") or {}).get("repository") or {}).get(k) or {}).get("edges", [])) for k in ("recent", "earliest", "latest")),
                "raw_response": "raw/graphql-star-probes.json",
            },
        },
        "collection": {
            "started_at_utc": started,
            "completed_at_utc": retrieved,
            "authenticated": bool(TOKEN),
            "api_rate_limit_observed_min_remaining": RATE["remaining"],
            "api_rate_limit": RATE["limit"],
            "api_rate_limit_used_at_last_response": RATE["used"],
            "api_rate_limit_reset_epoch": RATE["reset"],
            "requests_recorded": len(PROVENANCE),
        },
    }
    report = {
        "repository": result["repository"],
        "snapshot_at_utc": repository_meta["retrieved_at_utc"],
        "headline_metrics": result["snapshot_counts"],
        "repository_created_at_utc": created_at,
        "earliest_reachable_commit_author_date_utc": earliest_commit_date,
        "series": {
            "daily_commits_on_default_branch_by_author_date_utc": commit_timeline,
            "daily_commit_authorship_and_unique_logins_utc": author_timeline,
            "daily_stars_by_starred_at_utc": star_timeline if star_history_error is None else None,
        },
        "author_attribution_method": {
            "repository_owner_login": owner_login,
            "date_basis": "commit.commit.author.date, converted to UTC calendar day",
            "linked_identity": "commit.author.login from GitHub commit attribution object; counts unique login strings",
            "bot_rule": "commit.author.type equals Bot or login ends with [bot]",
            "categories": "Each commit is assigned once: bot first, then unlinked when GitHub author login is null, then owner login, otherwise other_linked.",
            "cumulative_rule": "A GitHub-linked login is added on its first observed UTC author-date day on the current default-branch history; human cumulative excludes bot accounts.",
            "history_limit": "These are author dates in the currently reachable default-branch history. They are not observation times; imported or rewritten commits can be backdated, and author attribution does not prove a unique natural person.",
        },
        "coverage": {
            "commit_count": len(commits),
            "commit_pages": last_commit_page,
            "star_records": total_history_stars if star_history_error is None else None,
            "star_history_complete_for_current_stargazers": result["star_history"]["complete_for_current_stargazers"],
            "release_count": len(releases),
            "contributor_identity_count": result["contributors"]["unique_endpoint_identities"],
            "api_requests": len(PROVENANCE),
            "minimum_rate_limit_remaining_observed": RATE["remaining"],
            "distinct_linked_author_logins_in_default_branch_history": len(first_author_day),
            "distinct_human_linked_author_logins_in_default_branch_history": len(first_author_day) - len(bot_logins),
            "distinct_bot_author_logins_in_default_branch_history": len(bot_logins),
        },
        "caveats": [
            "Repository creation time comes from GitHub repository metadata. The earliest reachable commit is a separate timestamp and may predate repository creation.",
            "Star history uses the stargazers endpoint's starred_at timestamps and covers currently returned stargazers; deleted accounts and stars removed before collection are not represented.",
            "GitHub restricted the stargazers listing endpoint to repository admins and collaborators in July 2026. This account received HTTP 404, so historical star dates are unavailable in this collection.",
            "A GraphQL probe returned the star count but no stargazer edges for newest, oldest, or unfiltered connections; event dates remain unavailable.",
            "The watchers field is GitHub subscribers_count (people watching notifications). The API's watchers_count mirrors stargazers_count and is not presented as notification watchers.",
            "Repository metadata's open_issues_count includes open pull requests; open_issues_only is the separate GitHub issue-search total.",
            result["contributors"]["attribution_note"],
            "Commit activity counts default-branch commits using author dates. It measures repository history, not unique human contributions or all branches.",
            "Language values are GitHub Linguist byte counts, not line counts.",
        ],
    }
    save_json(OUT / "metrics.json", result)
    save_json(OUT / "report.json", report)
    save_json(OUT / "provenance.json", {
        "api_base": API,
        "repository": f"{OWNER}/{REPO}",
        "retrieval_started_at_utc": started,
        "retrieval_completed_at_utc": retrieved,
        "authentication": "GitHub CLI credential used" if TOKEN else "Unauthenticated public GitHub REST API",
        "api_version_header": "2022-11-28",
        "raw_responses_directory": "raw/",
        "requests": sorted(PROVENANCE, key=lambda item: (item["path"], item["url"])),
        "rate_limit": RATE,
    })
    print(json.dumps({"snapshot_at_utc": retrieved, "stars": result["snapshot_counts"]["stars"],
                      "star_records": total_history_stars, "star_history_complete": result["star_history"]["complete_for_current_stargazers"],
                      "commit_count": len(commits), "commit_pages": last_commit_page,
                      "contributors": result["contributors"]["unique_endpoint_identities"], "releases": len(releases),
                      "api_requests": len(PROVENANCE), "rate_remaining": RATE["remaining"],
                      "out": str(OUT)}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"collection failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
