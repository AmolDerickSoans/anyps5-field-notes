"""Normalize the saved GitHub responses for the essay; never fetch at reader time."""
import json
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: json.loads((ROOT / p).read_text())
metrics = read('research/metrics/metrics.json')
report = read('research/metrics/report.json')
editorial = read('research/editorial/reporting.json')
sample = read('research/editorial/pr-sample.json')
commits = [c for p in sorted((ROOT / 'research/metrics/raw/commits').glob('page-*.json')) for c in json.loads(p.read_text())]
assert len(commits) == len({c['sha'] for c in commits}) == metrics['default_branch_commits']['count_from_rest_pagination']

series = report['series']['daily_commit_authorship_and_unique_logins_utc']
lookup = {d['date']: d for d in series}
start, end = date.fromisoformat(series[0]['date']), date.fromisoformat(series[-1]['date'])
activity, cumulative = [], 0
for i in range((end - start).days + 1):
    day = (start + timedelta(days=i)).isoformat()
    row = lookup.get(day, {})
    cumulative = row.get('cumulative_unique_linked_author_logins', cumulative)
    activity.append({'date': day, 'commits': row.get('commits', 0), 'uniqueAuthors': row.get('daily_unique_linked_author_logins', 0), 'cumulativeAuthors': cumulative})

# Count linked commit author logins directly, avoiding duplicate contributor-endpoint rows.
counts = Counter(c['author']['login'] for c in commits if c.get('author') and c['author'].get('login'))
contributors = [{'login': login, 'contributions': n, 'url': f'https://github.com/boykopovar/AnyPS5/commits/main/?author={login}'} for login, n in counts.most_common()]
closed = read('research/editorial/raw/closed-pulls.json')
assert len(closed) == len({r['number'] for r in closed}) == editorial['metrics']['closed']
merged = [r for r in closed if r.get('merged_at')]
authors = Counter(r['user'] for r in merged)
merged_authors = [{'login': login, 'mergedPrCount': n, 'url': f'https://github.com/boykopovar/AnyPS5/pulls?q=is%3Apr+is%3Amerged+author%3A{login}'} for login, n in sorted(authors.items())]
assert len(merged) == editorial['metrics']['merged']
assert len(authors) == editorial['metrics']['distinct_authors_with_merged_prs']
assert sum(d['commits'] for d in activity) == len(commits)
assert sum(b['count'] for b in sample['merge_duration_hours']['histogram']) == sample['sample_merged_count']
assert sum(a['mergedPrCount'] == 1 for a in merged_authors) == editorial['metrics']['authors_with_exactly_one_merged_pr']

last_week = [a for a in activity if '2026-10-06' <= a['date'] <= '2026-10-12']
data = {
    'repository': metrics['repository'], 'snapshot': metrics['snapshot_at_utc'],
    'counts': metrics['snapshot_counts'], 'commitCount': len(commits),
    'contributorEndpoint': metrics['contributors'], 'releaseCount': metrics['release_count'],
    'languages': metrics['languages_bytes'], 'activity': activity,
    'contributors': contributors, 'mergedAuthors': merged_authors,
    'population': editorial['metrics'], 'prSample': sample,
    'starHistory': metrics['star_history'], 'caveats': report['caveats'],
    'findings': {'peakDay': max(activity, key=lambda a: a['commits']), 'lastFullWeekCommits': sum(a['commits'] for a in last_week), 'lastFullWeekShare': sum(a['commits'] for a in last_week) / len(commits), 'repoAgeDays': (date.fromisoformat(metrics['snapshot_at_utc'][:10]) - date.fromisoformat(metrics['repository']['created_at_utc'][:10])).days},
    'sources': {
        'repo': 'https://github.com/boykopovar/AnyPS5',
        'commits': 'https://github.com/boykopovar/AnyPS5/commits/main/',
        'prs': 'https://github.com/boykopovar/AnyPS5/pulls',
        'readme': 'https://github.com/boykopovar/AnyPS5/blob/main/README.md',
        'contributing': 'https://github.com/boykopovar/AnyPS5/blob/main/CONTRIBUTING.md',
        'sample': sample['sources'][-1]
    }
}
(ROOT / 'dist/data.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({'commits': len(commits), 'calendarDays': len(activity), 'linkedCommitAuthors': len(counts), 'mergedPrAuthors': len(authors), 'sampleMerges': sample['sample_merged_count'], 'findings': data['findings']}))
