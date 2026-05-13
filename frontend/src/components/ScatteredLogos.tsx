import { useMemo } from 'react';

const allLogos = Object.entries(
  import.meta.glob('../assets/*.png', { eager: true, query: '?url', import: 'default' })
) as [string, string][];

const leftTeams = [
  'redskins', 'eagles', 'giants', 'cowboys',
  'seahawks', '49ers', 'rams', 'cardinals',
  'bears', 'packers', 'vikings', 'lions',
  'bucs', 'saints', 'panthers', 'falcons',
];

const overrides: Record<string, { size?: number; rotation?: number }> = {
  vikings: { size: 95, rotation: -3 },
};

function getTeamName(path: string) {
  const match = path.match(/\/([^/]+)\.png$/);
  return match ? match[1] : '';
}

interface Position {
  left: string;
  top: string;
  rotation: number;
  size: number;
  opacity: number;
}

function distributeLogos(logos: [string, string][], xMin: number, xMax: number): Position[] {
  const cols = 2;
  const rows = Math.ceil(logos.length / cols);
  const cellW = (xMax - xMin) / cols;
  const cellH = 100 / rows;

  return logos.map((entry, i) => {
    const team = getTeamName(entry[0]);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = ((i * 17) % 11 - 5) * (cellW * 0.04);
    const jitterY = ((i * 13) % 9 - 4) * (cellH * 0.04);
    const centerX = xMin + col * cellW + cellW / 2 + jitterX;
    const centerY = row * cellH + cellH / 2 + jitterY;

    const o = overrides[team];
    const rotation = o?.rotation ?? ((i * 137) % 30) - 15;
    const size = o?.size ?? 85 + (i % 3) * 12;
    const opacity = 1;

    return { left: `${centerX}%`, top: `${centerY}%`, rotation, size, opacity };
  });
}

export default function ScatteredLogos() {
  const { leftLogos, rightLogos } = useMemo(() => {
    const left: [string, string][] = [];
    const right: [string, string][] = [];
    for (const entry of allLogos) {
      const name = getTeamName(entry[0]);
      if (leftTeams.includes(name)) {
        left.push(entry);
      } else {
        right.push(entry);
      }
    }
    return { leftLogos: left, rightLogos: right };
  }, []);

  const leftPositions = useMemo(() => distributeLogos(leftLogos, 0, 18), [leftLogos]);
  const rightPositions = useMemo(() => distributeLogos(rightLogos, 82, 100), [rightLogos]);

  return (
    <div className="scattered-logos">
      {leftLogos.map(([path, url], i) => (
        <img
          key={path}
          src={url}
          className="scattered-logo"
          style={{
            left: leftPositions[i].left,
            top: leftPositions[i].top,
            width: leftPositions[i].size,
            height: leftPositions[i].size,
            transform: `translate(-50%, -50%) rotate(${leftPositions[i].rotation}deg)`,
            opacity: leftPositions[i].opacity,
          }}
          alt=""
        />
      ))}
      {rightLogos.map(([path, url], i) => (
        <img
          key={path}
          src={url}
          className="scattered-logo"
          style={{
            left: rightPositions[i].left,
            top: rightPositions[i].top,
            width: rightPositions[i].size,
            height: rightPositions[i].size,
            transform: `translate(-50%, -50%) rotate(${rightPositions[i].rotation}deg)`,
            opacity: rightPositions[i].opacity,
          }}
          alt=""
        />
      ))}
    </div>
  );
}
