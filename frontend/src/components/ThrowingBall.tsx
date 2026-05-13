export default function ThrowingBall() {
  return (
    <div className="throwing-ball-container">
      <svg viewBox="0 0 500 210" className="throwing-ball-svg">
        <defs>
          <path
            id="throwArc"
            d="M 80,120 Q 280,-20 440,80"
            fill="none"
          />
        </defs>

        {/* Field background */}
        <rect x="20" y="40" width="460" height="130" rx="4" fill="#2d6a2e" />

        {/* Field stripes (every ~46px = 10 yards) */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
          <line
            key={i}
            x1={20 + i * 46}
            y1="40"
            x2={20 + i * 46}
            y2="170"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1.5"
          />
        ))}

        {/* Yard numbers */}
        {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((num, i) => (
          <text
            key={i}
            x={66 + i * 46}
            y="165"
            textAnchor="middle"
            fill="rgba(255,255,255,0.3)"
            fontSize="10"
            fontFamily="'Russo One', sans-serif"
          >
            {num}
          </text>
        ))}

        {/* Hash marks */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i =>
          [0, 1, 2, 3].map(j => (
            <line
              key={`${i}-${j}`}
              x1={20 + i * 46 + (j + 1) * 9.2}
              y1="85"
              x2={20 + i * 46 + (j + 1) * 9.2}
              y2="90"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
            />
          ))
        )}

        {/* End zones */}
        <rect x="20" y="40" width="46" height="130" rx="4" fill="#8b0000" opacity="0.5" />
        <rect x="434" y="40" width="46" height="130" rx="4" fill="#1a3a5c" opacity="0.5" />
        <text x="43" y="115" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="'Press Start 2P', cursive" transform="rotate(-90, 43, 115)">HOME</text>
        <text x="457" y="115" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="'Press Start 2P', cursive" transform="rotate(90, 457, 115)">AWAY</text>

        {/* Dotted throw trail */}
        <path
          d="M 80,120 Q 280,-20 440,80"
          fill="none"
          stroke="#e8c547"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          opacity="0.5"
        />

        {/* Quarterback (left side) */}
        <g transform="translate(80, 68)">
          <ellipse cx="0" cy="0" rx="10" ry="11" fill="#c8102e" stroke="#8b0000" strokeWidth="1.5" />
          <rect x="-2" y="-2" width="12" height="4" rx="1" fill="#e8c547" />
          <rect x="-7" y="12" width="14" height="20" rx="3" fill="#fff" stroke="#ddd" strokeWidth="1" />
          <text x="0" y="26" textAnchor="middle" fill="#c8102e" fontSize="8" fontFamily="'Press Start 2P', cursive">4</text>
          <line x1="7" y1="16" x2="18" y2="4" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="18" y1="4" x2="22" y2="-2" stroke="#c8102e" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="-7" y1="18" x2="-14" y2="24" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="-3" y1="32" x2="-6" y2="48" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="3" y1="32" x2="8" y2="48" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <rect x="-9" y="46" width="7" height="4" rx="2" fill="#333" />
          <rect x="5" y="46" width="7" height="4" rx="2" fill="#333" />
        </g>

        {/* Receiver (in the end zone) */}
        <g transform="translate(452, 38)">
          <ellipse cx="0" cy="0" rx="10" ry="11" fill="#c8102e" stroke="#8b0000" strokeWidth="1.5" />
          <rect x="-10" y="-2" width="12" height="4" rx="1" fill="#e8c547" />
          <rect x="-7" y="12" width="14" height="20" rx="3" fill="#fff" stroke="#ddd" strokeWidth="1" />
          <text x="0" y="26" textAnchor="middle" fill="#c8102e" fontSize="8" fontFamily="'Press Start 2P', cursive">8</text>
          <line x1="-7" y1="14" x2="-18" y2="2" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="-18" y1="2" x2="-20" y2="-6" stroke="#c8102e" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="7" y1="14" x2="-4" y2="0" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="-4" y1="0" x2="-10" y2="-6" stroke="#c8102e" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="-3" y1="32" x2="-12" y2="46" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <line x1="3" y1="32" x2="10" y2="46" stroke="#c8102e" strokeWidth="3" strokeLinecap="round" />
          <rect x="-15" y="44" width="7" height="4" rx="2" fill="#333" />
          <rect x="7" y="44" width="7" height="4" rx="2" fill="#333" />
        </g>

        {/* Football following the arc */}
        <text fontSize="20" dominantBaseline="central" textAnchor="middle">
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            rotate="auto"
          >
            <mpath href="#throwArc" />
          </animateMotion>
          🏈
        </text>

        {/* TOUCHDOWN text - fades in when ball arrives, fades out before next throw */}
        <text
          x="250"
          y="198"
          textAnchor="middle"
          fill="#e8c547"
          fontSize="18"
          fontFamily="'Press Start 2P', cursive"
          letterSpacing="3"
        >
          <animate
            attributeName="opacity"
            values="0;0;0;1;1;1;0"
            keyTimes="0;0.6;0.75;0.8;0.9;0.95;1"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="font-size"
            values="0;0;0;22;20;18;0"
            keyTimes="0;0.6;0.75;0.8;0.9;0.95;1"
            dur="2s"
            repeatCount="indefinite"
          />
          TOUCHDOWN!
        </text>

        {/* Celebration flash behind text */}
        <rect x="120" y="180" width="260" height="28" rx="4" fill="#e8c547" opacity="0">
          <animate
            attributeName="opacity"
            values="0;0;0;0.15;0.1;0.05;0"
            keyTimes="0;0.6;0.75;0.8;0.9;0.95;1"
            dur="2s"
            repeatCount="indefinite"
          />
        </rect>
      </svg>
    </div>
  );
}
