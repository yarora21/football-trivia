import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from aws_xray_sdk.core import patch_all

patch_all()

# ESPN public API base URLs (no auth required)
_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
_STANDINGS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/standings'
_TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams'
_LEADERS = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/leaders'

# Map common team names to ESPN team IDs
_TEAM_IDS = {
    'cardinals': '22', 'falcons': '1', 'ravens': '33', 'bills': '2',
    'panthers': '29', 'bears': '3', 'bengals': '4', 'browns': '5',
    'cowboys': '6', 'broncos': '7', 'lions': '8', 'packers': '9',
    'texans': '34', 'colts': '11', 'jaguars': '30', 'chiefs': '12',
    'raiders': '13', 'chargers': '24', 'rams': '14', 'dolphins': '15',
    'vikings': '16', 'patriots': '17', 'saints': '18', 'giants': '19',
    'jets': '20', 'eagles': '21', 'steelers': '23', '49ers': '25',
    'seahawks': '26', 'buccaneers': '27', 'titans': '10', 'commanders': '28',
}

_SUPER_BOWL_FACTS = (
    'Super Bowl winners (recent): LVIII (2024) Kansas City Chiefs def. San Francisco 49ers 25-22 OT, '
    'LVII (2023) Kansas City Chiefs def. Philadelphia Eagles 38-35, '
    'LVI (2022) Los Angeles Rams def. Cincinnati Bengals 23-20, '
    'LV (2021) Tampa Bay Buccaneers def. Kansas City Chiefs 31-9, '
    'LIV (2020) Kansas City Chiefs def. San Francisco 49ers 31-20, '
    'LIII (2019) New England Patriots def. Los Angeles Rams 13-3, '
    'LII (2018) Philadelphia Eagles def. New England Patriots 41-33, '
    'LI (2017) New England Patriots def. Atlanta Falcons 34-28 OT, '
    'L (2016) Denver Broncos def. Carolina Panthers 24-10, '
    'XLIX (2015) New England Patriots def. Seattle Seahawks 28-24.'
)


def _fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'NFLTrivia/1.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _detect_team(topic):
    """Return the ESPN team ID if the topic mentions a known team name."""
    topic_lower = topic.lower()
    for name, team_id in _TEAM_IDS.items():
        if name in topic_lower:
            return team_id
    return None


def _detect_season(topic):
    """Return a four-digit year if the topic mentions one."""
    match = re.search(r'20[12]\d', topic)
    return match.group(0) if match else None


def _format_scoreboard(data):
    lines = []
    for event in data.get('events', [])[:10]:
        name = event.get('name', '')
        status = event.get('status', {}).get('type', {}).get('shortDetail', '')
        lines.append(f'{name}: {status}')
    return 'Recent NFL scores:\n' + '\n'.join(lines) if lines else ''


def _format_standings(data):
    lines = []
    for child in data.get('children', []):
        conf = child.get('name', '')
        for div in child.get('children', []):
            div_name = div.get('name', '')
            for entry in div.get('standings', {}).get('entries', []):
                team = entry.get('team', {}).get('displayName', '')
                stats = {s['name']: s['displayValue'] for s in entry.get('stats', [])}
                record = stats.get('overall', '')
                lines.append(f'{conf} {div_name}: {team} ({record})')
    return 'NFL standings:\n' + '\n'.join(lines[:32]) if lines else ''


def _format_team(data):
    team = data.get('team', {})
    name = team.get('displayName', '')
    record = team.get('record', {}).get('items', [{}])[0].get('summary', '')
    roster_lines = []
    for group in team.get('athletes', []):
        for athlete in group.get('items', [])[:5]:
            pname = athlete.get('displayName', '')
            pos = athlete.get('position', {}).get('abbreviation', '')
            roster_lines.append(f'  {pname} ({pos})')
    result = f'Team: {name}, Record: {record}\nKey players:\n' + '\n'.join(roster_lines[:15])
    return result


def _resolve_athlete(ref_url):
    """Fetch an athlete $ref URL and return a profile dict."""
    try:
        data = _fetch_json(ref_url)
        profile = {
            'name': data.get('displayName', ''),
            'position': data.get('position', {}).get('abbreviation', ''),
            'jersey': data.get('jersey', ''),
            'age': data.get('age', ''),
            'birthPlace': data.get('birthPlace', {}),
            'draft': data.get('draft', {}),
            'debutYear': data.get('debutYear', ''),
            'experience': data.get('experience', {}).get('years', ''),
            'height': data.get('displayHeight', ''),
            'weight': data.get('displayWeight', ''),
        }
        # Resolve college name (one extra call)
        college_ref = data.get('college', {}).get('$ref', '')
        if college_ref:
            try:
                college_data = _fetch_json(college_ref)
                profile['college'] = college_data.get('name', '')
            except Exception:
                profile['college'] = ''
        return profile
    except Exception as e:
        print(f'Failed to resolve athlete: {e}')
        return None


def _build_player_line(profile, cat_name, rank, stat_value):
    """Format a single player profile into a grounding fact line."""
    draft = profile.get('draft', {})
    bp = profile.get('birthPlace', {})
    birth = f"{bp.get('city', '')}, {bp.get('state', '')}".strip(', ')

    parts = [
        f'#{rank} {cat_name}: {profile["name"]} ({profile.get("position", "")}, #{profile.get("jersey", "")})',
        f'{stat_value}',
    ]
    if profile.get('college'):
        parts.append(f'College: {profile["college"]}')
    if draft.get('year'):
        parts.append(f'Draft: {draft["year"]} Rd {draft.get("round", "?")} Pick {draft.get("selection", "?")}')
    if profile.get('debutYear'):
        parts.append(f'Debut: {profile["debutYear"]}')
    if birth:
        parts.append(f'From: {birth}')
    if profile.get('experience'):
        parts.append(f'Exp: {profile["experience"]} yrs')
    if profile.get('height') and profile.get('weight'):
        parts.append(f'{profile["height"]}, {profile["weight"]}')
    return ' | '.join(parts)


def _format_leaders(data):
    # Collect all athlete refs we need to resolve
    refs_to_fetch = []  # list of (cat_name, rank, stat_value, ref_url)
    for cat in data.get('categories', [])[:5]:
        cat_name = cat.get('displayName', cat.get('name', ''))
        for rank, leader in enumerate(cat.get('leaders', [])[:3], 1):
            ref_url = leader.get('athlete', {}).get('$ref', '')
            stat_value = leader.get('displayValue', '')
            if ref_url:
                refs_to_fetch.append((cat_name, rank, stat_value, ref_url))

    if not refs_to_fetch:
        return ''

    # Resolve all athlete profiles in parallel
    profiles = {}  # ref_url -> profile
    with ThreadPoolExecutor(max_workers=10) as pool:
        future_to_ref = {
            pool.submit(_resolve_athlete, ref_url): ref_url
            for _, _, _, ref_url in refs_to_fetch
        }
        for future in as_completed(future_to_ref):
            ref_url = future_to_ref[future]
            result = future.result()
            if result:
                profiles[ref_url] = result

    # Build the formatted output
    lines = []
    for cat_name, rank, stat_value, ref_url in refs_to_fetch:
        profile = profiles.get(ref_url)
        if profile:
            lines.append(_build_player_line(profile, cat_name, rank, stat_value))

    return 'Season leaders:\n' + '\n'.join(lines) if lines else ''


def handler(event, context):
    topic = event.get('topic', '')
    facts = []

    topic_lower = topic.lower()

    # Super Bowl topic — use static facts
    if 'super bowl' in topic_lower:
        facts.append(_SUPER_BOWL_FACTS)

    # Team-specific topic
    team_id = _detect_team(topic)
    if team_id:
        try:
            team_data = _fetch_json(f'{_TEAMS}/{team_id}')
            facts.append(_format_team(team_data))
        except Exception as e:
            print(f'Failed to fetch team data: {e}')

    # Season-specific topic
    season = _detect_season(topic)
    if season:
        try:
            leaders_data = _fetch_json(_LEADERS.format(year=season))
            facts.append(_format_leaders(leaders_data))
        except Exception as e:
            print(f'Failed to fetch leaders data: {e}')

    # Always fetch current standings and scoreboard as baseline context
    try:
        standings_data = _fetch_json(_STANDINGS)
        facts.append(_format_standings(standings_data))
    except Exception as e:
        print(f'Failed to fetch standings: {e}')

    try:
        scoreboard_data = _fetch_json(_SCOREBOARD)
        facts.append(_format_scoreboard(scoreboard_data))
    except Exception as e:
        print(f'Failed to fetch scoreboard: {e}')

    grounding_facts = '\n\n'.join(f for f in facts if f)

    # Fall back to generic facts if everything failed
    if not grounding_facts:
        grounding_facts = _SUPER_BOWL_FACTS

    return {
        **event,
        'grounding_facts': grounding_facts,
    }
