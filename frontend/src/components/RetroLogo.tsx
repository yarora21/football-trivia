export default function RetroLogo() {
  return (
    <svg
      viewBox="0 0 200 240"
      className="retro-logo"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield shape */}
      <path
        d="M100 10 L185 50 L185 140 Q185 200 100 230 Q15 200 15 140 L15 50 Z"
        fill="#0b1a30"
        stroke="#e8c547"
        strokeWidth="5"
      />
      {/* Inner border */}
      <path
        d="M100 25 L172 58 L172 138 Q172 190 100 216 Q28 190 28 138 L28 58 Z"
        fill="none"
        stroke="#c8102e"
        strokeWidth="3"
      />
      {/* Football */}
      <ellipse cx="100" cy="110" rx="45" ry="28" fill="#8b4513" stroke="#5c2d00" strokeWidth="2" />
      <ellipse cx="100" cy="110" rx="45" ry="28" fill="url(#footballGrad)" />
      {/* Laces */}
      <line x1="100" y1="86" x2="100" y2="134" stroke="#f0e6d3" strokeWidth="2.5" />
      <line x1="88" y1="96" x2="112" y2="96" stroke="#f0e6d3" strokeWidth="2" />
      <line x1="86" y1="104" x2="114" y2="104" stroke="#f0e6d3" strokeWidth="2" />
      <line x1="86" y1="116" x2="114" y2="116" stroke="#f0e6d3" strokeWidth="2" />
      <line x1="88" y1="124" x2="112" y2="124" stroke="#f0e6d3" strokeWidth="2" />
      {/* Top text */}
      <text x="100" y="52" textAnchor="middle" fill="#e8c547" fontFamily="'Press Start 2P', cursive" fontSize="11">
        NFL
      </text>
      {/* Bottom text */}
      <text x="100" y="165" textAnchor="middle" fill="#e8c547" fontFamily="'Press Start 2P', cursive" fontSize="8">
        TRIVIA
      </text>
      {/* Stars */}
      <text x="55" y="53" textAnchor="middle" fill="#e8c547" fontSize="12">★</text>
      <text x="145" y="53" textAnchor="middle" fill="#e8c547" fontSize="12">★</text>
      {/* Gradient for football */}
      <defs>
        <linearGradient id="footballGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.2)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
