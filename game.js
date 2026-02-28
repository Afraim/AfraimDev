const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const progressEl = document.getElementById('progress');
const popupBackdrop = document.getElementById('popupBackdrop');
const popupTitle = document.getElementById('popupTitle');
const popupBody = document.getElementById('popupBody');
const popupImage = document.getElementById('popupImage');
const popupLink = document.getElementById('popupLink');
const popupContinue = document.getElementById('popupContinue');

const keys = {};
let popupOpen = false;
let sparkles = [];
let clickableCards = [];
let depthBuffer = [];
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const joystick = {
  active: false,
  pointerId: null,
  baseX: 0,
  baseY: 0,
  startX: 0,
  startY: 0,
  knobX: 0,
  knobY: 0,
  inputX: 0,
  inputY: 0,
  renderInputX: 0,
  renderInputY: 0,
  maxRadius: 70,
  deadzone: 0.14,
  moved: false,
  tapCandidate: false
};
let suppressCardClickUntil = 0;
const TILE = 64;
const FOV = Math.PI / 3;
const MAX_DEPTH = TILE * 18;
const MAZE_WIDTH = 45;
const MAZE_HEIGHT = 29;

function generateMaze(width, height) {
  const w = width % 2 === 0 ? width - 1 : width;
  const h = height % 2 === 0 ? height - 1 : height;
  const grid = Array.from({ length: h }, () => Array(w).fill(1));

  let seed = 20260228;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const shuffle = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const stack = [[1, 1]];
  grid[1][1] = 0;
  const directions = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2]
  ];

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    let carved = false;

    for (const [dx, dy] of shuffle(directions)) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
      if (grid[ny][nx] === 0) continue;

      grid[cy + dy / 2][cx + dx / 2] = 0;
      grid[ny][nx] = 0;
      stack.push([nx, ny]);
      carved = true;
      break;
    }

    if (!carved) stack.pop();
  }

  for (let room = 0; room < 10; room += 1) {
    const roomW = 3 + Math.floor(rand() * 4);
    const roomH = 3 + Math.floor(rand() * 4);
    const rx = 2 + Math.floor(rand() * (w - roomW - 3));
    const ry = 2 + Math.floor(rand() * (h - roomH - 3));

    for (let y = ry; y < ry + roomH; y += 1) {
      for (let x = rx; x < rx + roomW; x += 1) {
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          grid[y][x] = 0;
        }
      }
    }
  }

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (grid[y][x] === 0 || rand() > 0.1) continue;

      const openLeftRight = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
      const openUpDown = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
      if (openLeftRight || openUpDown) {
        grid[y][x] = 0;
      }
    }
  }

  for (let x = 1; x <= 4; x += 1) grid[1][x] = 0;
  for (let y = 1; y <= 4; y += 1) grid[y][1] = 0;

  return grid;
}

const maze = generateMaze(MAZE_WIDTH, MAZE_HEIGHT);

const player = {
  x: TILE * 1.5,
  y: TILE * 1.5,
  angle: 0,
  moveSpeed: 2.2,
  turnSpeed: 0.045,
  radius: 14
};

function getOpenTileCenters() {
  const centers = [];
  for (let y = 0; y < maze.length; y += 1) {
    for (let x = 0; x < maze[0].length; x += 1) {
      if (maze[y][x] === 0) {
        centers.push({
          x: (x + 0.5) * TILE,
          y: (y + 0.5) * TILE
        });
      }
    }
  }
  return centers;
}

function radiusForKind(kind) {
  if (kind === 'project' || kind === 'award') return 20;
  if (kind === 'experience' || kind === 'education' || kind === 'research') return 19;
  return 18;
}

function assignItemPositions(entries) {
  const openTiles = getOpenTileCenters();
  const wallSlots = [];
  const used = new Set();
  const minDistance = TILE * 2.35;

  openTiles.forEach((tile) => {
    const tileX = Math.floor(tile.x / TILE);
    const tileY = Math.floor(tile.y / TILE);
    const walls = [];

    if (maze[tileY][tileX - 1] === 1) walls.push({ dx: -1, dy: 0 });
    if (maze[tileY][tileX + 1] === 1) walls.push({ dx: 1, dy: 0 });
    if (maze[tileY - 1][tileX] === 1) walls.push({ dx: 0, dy: -1 });
    if (maze[tileY + 1][tileX] === 1) walls.push({ dx: 0, dy: 1 });
    if (!walls.length) return;

    const direction = walls[(tileX * 3 + tileY * 5) % walls.length];
    const edgeInset = TILE * 0.16;
    wallSlots.push({
      x: tile.x + direction.dx * (TILE / 2 - edgeInset),
      y: tile.y + direction.dy * (TILE / 2 - edgeInset)
    });
  });

  return entries.map((entry, index) => {
    let pointer = (index * 11) % wallSlots.length;
    let safety = 0;

    while (safety < wallSlots.length) {
      const spot = wallSlots[pointer];
      const tooCloseToStart = Math.hypot(spot.x - player.x, spot.y - player.y) < TILE * 1.5;
      const tooCloseToOther = Array.from(used).some((usedIndex) => {
        const placed = wallSlots[usedIndex];
        return Math.hypot(spot.x - placed.x, spot.y - placed.y) < minDistance;
      });

      if (!used.has(pointer) && !tooCloseToStart && !tooCloseToOther) {
        used.add(pointer);
        return {
          ...entry,
          x: spot.x,
          y: spot.y,
          radius: radiusForKind(entry.kind)
        };
      }
      pointer = (pointer + 1) % wallSlots.length;
      safety += 1;
    }

    for (let fallback = 0; fallback < wallSlots.length; fallback += 1) {
      if (!used.has(fallback)) {
        used.add(fallback);
        return {
          ...entry,
          x: wallSlots[fallback].x,
          y: wallSlots[fallback].y,
          radius: radiusForKind(entry.kind)
        };
      }
    }

    return {
      ...entry,
      x: openTiles[0].x,
      y: openTiles[0].y,
      radius: radiusForKind(entry.kind)
    };
  });
}

const portfolioEntries = [
  {
    id: 'about-1',
    kind: 'about',
    title: 'About Me',
    body: 'MD. Afraim Bin Zahangir. Energetic, dependable, self-motivated, and passionate about learning and sharing knowledge.',
    image: '🏳️',
    link: ''
  },
  {
    id: 'about-2',
    kind: 'about',
    title: 'Location',
    body: 'Abdullahbag, Shatarkul, North Badda, Dhaka, Bangladesh.',
    image: '📍',
    link: ''
  },
  {
    id: 'skill-1',
    kind: 'skill',
    title: 'Skill Star: Web & Data Stack',
    body: 'HTML, CSS, JavaScript, Python, Django, WordPress, PostgreSQL, SQL, C++, Java, and C#.',
    image: '⭐',
    link: ''
  },
  {
    id: 'skill-2',
    kind: 'skill',
    title: 'Skill Star: EdTech Tools',
    body: 'Scratch, Construct3, and MIT App Inventor for practical project-based learning.',
    image: '✨',
    link: ''
  },
  {
    id: 'exp-1',
    kind: 'experience',
    title: 'Experience: Branch Teacher Leader',
    body: 'TimeDoor Coding Academy (Mar 2023 - Jul 2024, Part-Time). Upskilled 10+ educators, curated curriculum materials, and improved teaching quality.',
    image: '💼',
    link: ''
  },
  {
    id: 'exp-2',
    kind: 'experience',
    title: 'Experience: Online Programming Teacher',
    body: 'TimeDoor Coding Academy (Dec 2021 - Jul 2024, Part-Time). Delivered 3500+ classes and helped students publish 200+ projects.',
    image: '👨‍🏫',
    link: ''
  },
  {
    id: 'exp-3',
    kind: 'experience',
    title: 'Experience: Lecturer',
    body: 'United College of Aviation Science and Management (Aug 2023 - Dec 2023, Full-Time). Delivered 500+ classes across 10+ subjects.',
    image: '📘',
    link: ''
  },
  {
    id: 'exp-4',
    kind: 'experience',
    title: 'Experience: Teaching Assistant',
    body: 'ULAB Department of CSE (Nov 2020 - May 2022, Contract). Supported 5 courses and conducted 500+ classes online and offline.',
    image: '🧑‍🏫',
    link: ''
  },
  {
    id: 'exp-5',
    kind: 'experience',
    title: 'Experience: Peer Mentor',
    body: 'ULAB Student Affairs (Sep 2019 - Apr 2020, Contract). Guided newcomers and resolved student concerns and conflicts.',
    image: '🤝',
    link: ''
  },
  {
    id: 'edu-1',
    kind: 'education',
    title: 'Education: MSc in CSE (Data Science)',
    body: 'United International University. GPA 3.56. May 2023 - Feb 2025.',
    image: '🎓',
    link: ''
  },
  {
    id: 'edu-2',
    kind: 'education',
    title: 'Education: BSc in CSE',
    body: 'University of Liberal Arts Bangladesh. Honor List Cum Laude, GPA 3.83. Feb 2018 - Oct 2022.',
    image: '🏅',
    link: ''
  },
  {
    id: 'edu-3',
    kind: 'education',
    title: 'Education: HSC',
    body: 'Dhaka Residential Model College (English Version - Science). GPA 4.17. 2015 - 2017.',
    image: '📚',
    link: ''
  },
  {
    id: 'edu-4',
    kind: 'education',
    title: 'Education: SSC',
    body: 'BIAM Laboratory School, Naogaon (English Version - Science). GPA 5.00. 2013 - 2015.',
    image: '🏫',
    link: ''
  },
  {
    id: 'research-1',
    kind: 'research',
    title: 'Research Focus',
    body: 'Main research areas: IoT, Artificial Intelligence, and Robotics.',
    image: '🔬',
    link: ''
  },
  {
    id: 'research-2',
    kind: 'research',
    title: 'Publication',
    body: 'Roof Garden Irrigation and Drainage Automation Using Microcontroller (Springer, 2022, Co-Author).',
    image: '📄',
    link: 'https://link.springer.com/chapter/10.1007/978-981-19-5224-1_36'
  },
  {
    id: 'research-3',
    kind: 'research',
    title: 'Ongoing Research',
    body: 'Optimising digital marketing for startups using AI, and AI-enhanced learning systems with misuse mitigation.',
    image: '🧠',
    link: ''
  },
  {
    id: 'proj-client-1',
    kind: 'project',
    title: 'Client Project: Internal HRM System',
    body: 'For Incepta Pharmaceuticals Ltd: attendance, leave, overtime, payroll, and employee management.',
    image: '🧰',
    link: ''
  },
  {
    id: 'proj-client-2',
    kind: 'project',
    title: 'Client Project: Railing Quote Generator',
    body: 'For AlumaVerse: dynamic material calculator and quotation generator with pricing automation.',
    image: '📐',
    link: ''
  },
  {
    id: 'proj-client-3',
    kind: 'project',
    title: 'Client Project: MisoVibes Website',
    body: 'Custom responsive website with optimized performance and modern design.',
    image: '🌐',
    link: 'https://misovibes.com/'
  },
  {
    id: 'proj-client-4',
    kind: 'project',
    title: 'Client Project: BinaryCGI Profile',
    body: 'Professional company profile site showcasing services, portfolio, and brand identity.',
    image: '🏢',
    link: 'https://binarycgi.com/'
  },
  {
    id: 'proj-client-5',
    kind: 'project',
    title: 'Client Project: Saz Vanity E-Commerce',
    body: 'E-commerce store with catalog, cart, and secure checkout.',
    image: '🛒',
    link: 'https://sazvanity.com/'
  },
  {
    id: 'proj-client-6',
    kind: 'project',
    title: 'Client Project: Solar Home BD',
    body: 'Clean company profile site for a solar energy solutions provider.',
    image: '☀️',
    link: 'https://solarhomebd.com/'
  },
  {
    id: 'proj-client-7',
    kind: 'project',
    title: 'Client Project: Unida Furnishers E-Commerce',
    body: 'Furniture e-commerce site with gallery, order system, and user-friendly UI.',
    image: '🪑',
    link: 'https://www.unidafurnishers.com/'
  },
  {
    id: 'class-1',
    kind: 'project',
    title: 'Online Class: Making a Game',
    body: 'Step-by-step tutorial for students to build a simple game from scratch.',
    image: '🎮',
    link: 'https://youtu.be/d3Nlifc0tA4'
  },
  {
    id: 'class-2',
    kind: 'project',
    title: 'Online Class: Google Site Website',
    body: 'Tutorial on creating a simple website using Google Sites.',
    image: '🖥️',
    link: 'https://youtu.be/swPQFBeWT7o'
  },
  {
    id: 'class-3',
    kind: 'project',
    title: 'Online Class: Calculator Project',
    body: 'Teaching programming basics by building a calculator with HTML, CSS, and JS.',
    image: '🧮',
    link: 'https://youtu.be/c8twzwBfLFU'
  },
  {
    id: 'class-4',
    kind: 'project',
    title: 'Online Class: Scratch Game Making',
    body: 'Interactive coding tutorial for kids through Scratch game design.',
    image: '🧩',
    link: 'https://youtu.be/XqI6h-8jqPs'
  },
  {
    id: 'proj-personal-1',
    kind: 'project',
    title: 'Personal Project: FlipBook',
    body: 'Interactive digital flipbook built with HTML, CSS, and JavaScript.',
    image: '📖',
    link: 'https://github.com/Afraim/flipBook'
  },
  {
    id: 'proj-personal-2',
    kind: 'project',
    title: 'Personal Project: Tic-Tac-Toe',
    body: 'Classic browser game built with HTML, CSS, and JavaScript.',
    image: '⭕',
    link: 'https://github.com/Afraim/Tic-Tac-Toe'
  },
  {
    id: 'proj-personal-3',
    kind: 'project',
    title: 'Personal Project: Rock Paper Scissors',
    body: 'Interactive Rock Paper Scissors game in HTML, CSS, and JS.',
    image: '✂️',
    link: 'https://github.com/Afraim/RPS'
  },
  {
    id: 'proj-personal-4',
    kind: 'project',
    title: 'Personal Project: Hangman',
    body: 'Classic Hangman word-guessing game developed in C#.',
    image: '🔤',
    link: 'https://github.com/Afraim/HangMan-Csharp'
  },
  {
    id: 'proj-personal-5',
    kind: 'project',
    title: 'Personal Project: Doctor\'s Desk',
    body: 'Medical management system built with C# and SQL for doctors\' daily use.',
    image: '🩺',
    link: 'https://github.com/Afraim/doctor_s-desk'
  },
  {
    id: 'proj-personal-6',
    kind: 'project',
    title: 'Personal Project: Home Water Tank System',
    body: 'IoT-based water tank monitoring using Arduino, Firebase, and Java.',
    image: '💧',
    link: 'https://github.com/Afraim/ARC'
  },
  {
    id: 'interest-1',
    kind: 'interest',
    title: 'Interest: Indie Game Development',
    body: 'Builds small games with Construct3 and Scratch, published on afraim.itch.io.',
    image: '🎯',
    link: 'https://afraim.itch.io/'
  },
  {
    id: 'interest-2',
    kind: 'interest',
    title: 'Interest: Mobile Photography',
    body: 'Enjoys nature walks and capturing sunsets, flowers, birds, and bees.',
    image: '📷',
    link: ''
  },
  {
    id: 'interest-3',
    kind: 'interest',
    title: 'Interest: Story Writing',
    body: 'Writes stories; science fiction story "H.O.P.E" earned second place in IEEE IUT Platform R.E.D 2.0.',
    image: '✍️',
    link: ''
  },
  {
    id: 'award-1',
    kind: 'award',
    title: 'Award: 1st Place - In the Shadow',
    body: 'IEEE ULAB Student Branch CONQUEST 20, Inter-University Game Narrative Design Writing Competition (2020).',
    image: '🥇',
    link: ''
  },
  {
    id: 'award-2',
    kind: 'award',
    title: 'Award: 2nd Place - H.O.P.E',
    body: 'IEEE IUT Student Branch Platform R.E.D 0.2, Science Fiction category (2019).',
    image: '🥈',
    link: ''
  },
  {
    id: 'award-3',
    kind: 'award',
    title: 'Award: Honorable Mention - Farming 2.0',
    body: 'ULAB Tech Fest Project Showcase (2019).',
    image: '🏅',
    link: ''
  },
  {
    id: 'award-4',
    kind: 'award',
    title: 'Award: 3rd - MSD Mobile Security Device',
    body: 'ULAB EEE Department Project Showcase (2019).',
    image: '🏆',
    link: ''
  },
  {
    id: 'cert-1',
    kind: 'certification',
    title: 'Certification: Azure DevOps Board',
    body: 'Getting Started with Azure DevOps Board - Coursera (Aug 2022).',
    image: '📜',
    link: 'https://coursera.org/verify/96HU3F68F4W3'
  },
  {
    id: 'cert-2',
    kind: 'certification',
    title: 'Certification: Canva Course Collateral',
    body: 'Use Canva to Design Digital Course Collateral - Coursera (Aug 2022).',
    image: '📜',
    link: 'https://coursera.org/verify/JDX4ZE674WUV'
  },
  {
    id: 'cert-3',
    kind: 'certification',
    title: 'Certification: AI Object Detection',
    body: 'Build an AI Object Detection Engine in 30 Minutes Bootcamp - Open Weaver (Mar 2022).',
    image: '📜',
    link: 'https://certificates.openweaver.com/en/verify/69138630089333?ref'
  },
  {
    id: 'cert-4',
    kind: 'certification',
    title: 'Certification: SQL Data Manipulation',
    body: 'Manipulation Data with SQL - Coursera (Dec 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/76TF36S8BHBS'
  },
  {
    id: 'cert-5',
    kind: 'certification',
    title: 'Certification: Bash Shell Scripting',
    body: 'Introduction to Bash Shell Scripting - Coursera (Nov 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/NTRK7ZBXM4ME'
  },
  {
    id: 'cert-6',
    kind: 'certification',
    title: 'Certification: Learn to Code using C#',
    body: 'Coursera (Nov 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/TAYSZX9XHB2C'
  },
  {
    id: 'cert-7',
    kind: 'certification',
    title: 'Certification: Programming in C#',
    body: 'Coursera (Nov 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/XQLNA7DB5CYS'
  },
  {
    id: 'cert-8',
    kind: 'certification',
    title: 'Certification: Command Line in Linux',
    body: 'Coursera (Oct 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/C44ZVL6CQTMV'
  },
  {
    id: 'cert-9',
    kind: 'certification',
    title: 'Certification: Scratch Game Development',
    body: 'Introduction to Basic Game Development using Scratch - Coursera (Oct 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/PJU9UP28FKLU'
  },
  {
    id: 'cert-10',
    kind: 'certification',
    title: 'Certification: Python for Everybody',
    body: 'Programming for Everybody and Python Data Structures - Coursera (Oct 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/HJU4BV5DDM67'
  },
  {
    id: 'cert-11',
    kind: 'certification',
    title: 'Certification: Power BI Desktop',
    body: 'Getting Started with Power BI Desktop - Coursera (Aug 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/B43VWHWU6T6C'
  },
  {
    id: 'cert-12',
    kind: 'certification',
    title: 'Certification: WordPress Website',
    body: 'Build a Full Website using WordPress - Coursera (Jul 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/87HSXEGBHBNA'
  },
  {
    id: 'cert-13',
    kind: 'certification',
    title: 'Certification: Excel Skills Essentials',
    body: 'Excel Skills for Business: Essentials - Coursera (Jul 2020).',
    image: '📜',
    link: 'https://coursera.org/verify/6SW4VTAQBA9D'
  },
  {
    id: 'contact-1',
    kind: 'contact',
    title: 'Contact: Email',
    body: 'afraim.zahangir@gmail.com',
    image: '📧',
    link: 'mailto:afraim.zahangir@gmail.com'
  },
  {
    id: 'contact-2',
    kind: 'contact',
    title: 'Contact: Phone',
    body: '+880 1715-169 263',
    image: '📞',
    link: 'tel:+8801715169263'
  },
  {
    id: 'contact-3',
    kind: 'contact',
    title: 'Social: LinkedIn',
    body: 'linkedin.com/in/afraim-zahangir',
    image: '💼',
    link: 'https://www.linkedin.com/in/afraim-zahangir/'
  },
  {
    id: 'contact-4',
    kind: 'contact',
    title: 'Social: GitHub',
    body: 'github.com/Afraim',
    image: '🐙',
    link: 'https://github.com/Afraim'
  },
  {
    id: 'contact-5',
    kind: 'contact',
    title: 'Social: Facebook',
    body: 'facebook.com/afraim.zahangir',
    image: '📘',
    link: 'https://www.facebook.com/afraim.zahangir/'
  },
  {
    id: 'contact-6',
    kind: 'contact',
    title: 'Social: CodePen',
    body: 'codepen.io/a-zahangir',
    image: '🧪',
    link: 'https://codepen.io/a-zahangir/'
  },
  {
    id: 'contact-7',
    kind: 'contact',
    title: 'Social: Instagram',
    body: 'instagram.com/ibn_zahangir',
    image: '📸',
    link: 'https://www.instagram.com/ibn_zahangir/'
  }
];

const items = assignItemPositions(portfolioEntries).map((item) => ({ ...item, collected: false }));

function isWallAt(x, y) {
  const mx = Math.floor(x / TILE);
  const my = Math.floor(y / TILE);

  if (my < 0 || my >= maze.length || mx < 0 || mx >= maze[0].length) {
    return true;
  }
  return maze[my][mx] === 1;
}

function nearestOpenTileCenter(x, y) {
  const startX = Math.floor(x / TILE);
  const startY = Math.floor(y / TILE);
  const maxRadius = Math.max(maze.length, maze[0].length);

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const tx = startX + dx;
        const ty = startY + dy;

        if (ty < 0 || ty >= maze.length || tx < 0 || tx >= maze[0].length) continue;
        if (maze[ty][tx] === 0) {
          return {
            x: (tx + 0.5) * TILE,
            y: (ty + 0.5) * TILE
          };
        }
      }
    }
  }

  return { x, y };
}

function ensureItemsAreAccessible() {
  items.forEach((item) => {
    if (isWallAt(item.x, item.y)) {
      const safePos = nearestOpenTileCenter(item.x, item.y);
      item.x = safePos.x;
      item.y = safePos.y;
    }
  });
}

function normalizeAngle(angle) {
  let value = angle;
  while (value < 0) value += Math.PI * 2;
  while (value >= Math.PI * 2) value -= Math.PI * 2;
  return value;
}

function getKindColor(kind) {
  const colors = {
    skill: '#ffe77a',
    project: '#d6a55b',
    contact: '#9bd0ff',
    about: '#ffa882',
    experience: '#ffbe7d',
    education: '#b8ff9f',
    research: '#d2b0ff',
    interest: '#ff9ec7',
    award: '#ffd966',
    certification: '#b0f0ff'
  };

  return colors[kind] || '#ffa882';
}

function castRay(rayAngle) {
  const angle = normalizeAngle(rayAngle);
  const step = 2;
  let depth = 0;

  while (depth < MAX_DEPTH) {
    const targetX = player.x + Math.cos(angle) * depth;
    const targetY = player.y + Math.sin(angle) * depth;
    if (isWallAt(targetX, targetY)) {
      return {
        distance: depth,
        hitX: targetX,
        hitY: targetY
      };
    }
    depth += step;
  }

  return {
    distance: MAX_DEPTH,
    hitX: player.x + Math.cos(angle) * MAX_DEPTH,
    hitY: player.y + Math.sin(angle) * MAX_DEPTH
  };
}

function drawSkyAndFloor() {
  const half = canvas.height / 2;
  const sky = ctx.createLinearGradient(0, 0, 0, half);
  sky.addColorStop(0, '#2f6bbf');
  sky.addColorStop(1, '#7db7ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, half);

  const floor = ctx.createLinearGradient(0, half, 0, canvas.height);
  floor.addColorStop(0, '#3b5f3f');
  floor.addColorStop(1, '#233425');
  ctx.fillStyle = floor;
  ctx.fillRect(0, half, canvas.width, half);
}

function drawWalls() {
  drawSkyAndFloor();
  const numRays = canvas.width;
  let turnInput = 0;
  let moveInput = 0;

  if (keys.KeyA || keys.ArrowLeft) {
    turnInput -= 1;
  }
  if (keys.KeyD || keys.ArrowRight) {
    turnInput += 1;
  }
  if (keys.KeyW || keys.ArrowUp) {
    moveInput += 1;
  }
  if (keys.KeyS || keys.ArrowDown) {
    moveInput -= 1;
  }

  if (joystick.active) {
    turnInput += joystick.inputX;
    moveInput += -joystick.inputY;
  }

  turnInput = Math.max(-1, Math.min(1, turnInput));
  moveInput = Math.max(-1, Math.min(1, moveInput));

  if (Math.abs(turnInput) > 0.01) {
    player.angle += player.turnSpeed * turnInput;
  }

  player.angle = normalizeAngle(player.angle);

  if (Math.abs(moveInput) > 0.01) {
    const forwardX = Math.cos(player.angle);
    const forwardY = Math.sin(player.angle);
    const speed = player.moveSpeed * moveInput;
    const nextX = player.x + forwardX * speed;
    const nextY = player.y + forwardY * speed;
    tryMove(nextX, nextY);
  }
}

function drawJoystickOverlay() {
  if (!isTouchDevice) return;
  updateJoystickBase();

  ctx.save();
  ctx.globalAlpha = joystick.active ? 0.82 : 0.5;
  ctx.beginPath();
  ctx.arc(joystick.baseX, joystick.baseY, joystick.maxRadius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(44, 74, 134, 0.22)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(46, 88, 255, 0.8)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(joystick.knobX, joystick.knobY, 28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(79, 124, 255, 0.86)';
  ctx.fill();
  ctx.restore();
}

function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function updateJoystick(x, y) {
  const dx = x - joystick.baseX;
  const dy = y - joystick.baseY;
  const distance = Math.hypot(dx, dy);

  let clampedX = dx;
  let clampedY = dy;
  if (distance > joystick.maxRadius) {
    const ratio = joystick.maxRadius / distance;
    clampedX *= ratio;
    clampedY *= ratio;
  }

  joystick.knobX = joystick.baseX + clampedX;
  joystick.knobY = joystick.baseY + clampedY;
  const rawX = clampedX / joystick.maxRadius;
  const rawY = clampedY / joystick.maxRadius;

  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude < joystick.deadzone) {
    joystick.inputX = 0;
    joystick.inputY = 0;
  } else {
    const normalized = (magnitude - joystick.deadzone) / (1 - joystick.deadzone);
    const scale = normalized / magnitude;
    joystick.inputX = rawX * scale;
    joystick.inputY = rawY * scale;
  }

  if (Math.hypot(clampedX, clampedY) > 8) {
    joystick.moved = true;
    joystick.tapCandidate = false;
  }
}

function resetJoystick() {
  joystick.active = false;
  joystick.pointerId = null;
  updateJoystickBase();
  joystick.startX = joystick.baseX;
  joystick.startY = joystick.baseY;
  joystick.knobX = joystick.baseX;
  joystick.knobY = joystick.baseY;
  joystick.inputX = 0;
  joystick.inputY = 0;
  joystick.moved = false;
  joystick.tapCandidate = false;
}

function updateJoystickBase() {
  joystick.baseX = 50 + joystick.maxRadius;
  joystick.baseY = canvas.height - 50 - joystick.maxRadius;
  if (!joystick.active) {
    joystick.startX = joystick.baseX;
    joystick.startY = joystick.baseY;
    joystick.knobX = joystick.baseX;
    joystick.knobY = joystick.baseY;
  }
}

function isInsideJoystickActivation(point) {
  const activationRadius = joystick.maxRadius + 20;
  return Math.hypot(point.x - joystick.baseX, point.y - joystick.baseY) <= activationRadius;
}

function handleCardInteractionAt(x, y) {
  for (const card of clickableCards) {
    const inside =
      x >= card.x &&
      x <= card.x + card.width &&
      y >= card.y &&
      y <= card.y + card.height;

    if (!inside) continue;

    if (!card.item.collected) {
      card.item.collected = true;
      createSparkles(card.item.x, card.item.y);
      updateProgress();
    }
    showPopup(card.item);
    return true;
  }

  return false;
}

function handleJoystickPointerDown(event) {
  if (popupOpen) return;
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
  if (!event.isPrimary) return;
  if (joystick.active) return;

  updateJoystickBase();
  const point = getCanvasPoint(event.clientX, event.clientY);
  if (!isInsideJoystickActivation(point)) return;

  joystick.active = true;
  joystick.pointerId = event.pointerId;
  joystick.startX = joystick.baseX;
  joystick.startY = joystick.baseY;
  joystick.knobX = joystick.baseX;
  joystick.knobY = joystick.baseY;
  joystick.inputX = 0;
  joystick.inputY = 0;
  joystick.moved = false;
  joystick.tapCandidate = false;

  updateJoystick(point.x, point.y);

  if (canvas.setPointerCapture) {
    canvas.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
}

function handleJoystickPointerMove(event) {
  if (!joystick.active) return;
  if (event.pointerId !== joystick.pointerId) return;

  const point = getCanvasPoint(event.clientX, event.clientY);
  updateJoystick(point.x, point.y);
  event.preventDefault();
}

function handleJoystickPointerUp(event) {
  if (!joystick.active) return;
  if (event.pointerId !== joystick.pointerId) return;

  if (joystick.moved) {
    suppressCardClickUntil = performance.now() + 280;
  }

  resetJoystick();

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  event.preventDefault();
}

function handleJoystickPointerCancel(event) {
  if (!joystick.active) return;
  if (event.pointerId !== joystick.pointerId) return;
  resetJoystick();
}

function setupGhostJoystick() {
  updateJoystickBase();
  canvas.addEventListener('pointerdown', handleJoystickPointerDown, { passive: false });
  canvas.addEventListener('pointermove', handleJoystickPointerMove, { passive: false });
  canvas.addEventListener('pointerup', handleJoystickPointerUp, { passive: false });
  canvas.addEventListener('pointercancel', handleJoystickPointerCancel, { passive: false });
  window.addEventListener('pointerup', handleJoystickPointerUp, { passive: false });
  window.addEventListener('pointercancel', handleJoystickPointerCancel, { passive: false });
  window.addEventListener('resize', updateJoystickBase);
}

function setupMouseCardClick() {
  canvas.addEventListener('click', (event) => {
    if (popupOpen) return;
    if (performance.now() < suppressCardClickUntil) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    handleCardInteractionAt(point.x, point.y);
  });
}

function setupKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (popupOpen) {
      if (event.code === 'Space') {
        event.preventDefault();
        hidePopup();
        return;
      }
    }
    keys[event.code] = true;
  });

  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });
}

function setupPopupContinue() {
  popupContinue.addEventListener('click', hidePopup);
}

function initializeControls() {
  canvas.style.touchAction = 'none';
  setupKeyboard();
  setupMouseCardClick();
  setupGhostJoystick();
  setupPopupContinue();
}

function projectCard(item) {
  const dx = item.x - player.x;
  const dy = item.y - player.y;
  const distance = Math.hypot(dx, dy);
  const angleTo = Math.atan2(dy, dx);
  let relative = normalizeAngle(angleTo - player.angle);
  if (relative > Math.PI) relative -= Math.PI * 2;

  if (Math.abs(relative) > FOV / 2 + 0.22 || distance < 1) return null;

  const losRay = castRay(angleTo);
  if (losRay.distance < distance - 6) return null;

  const perpendicularDistance = distance * Math.cos(relative);
  if (perpendicularDistance <= 0.01) return null;

  const projection = (canvas.width / 2) / Math.tan(FOV / 2);
  const size = Math.min(180, (TILE / perpendicularDistance) * projection * 1.08 + 12);
  const screenX = (canvas.width / 2) + Math.tan(relative) * projection;
  const screenY = canvas.height / 2 + size * 0.15;

  const depthColumn = Math.max(0, Math.min(canvas.width - 1, Math.round(screenX)));
  const wallDepth = depthBuffer[depthColumn] ?? Infinity;
  if (perpendicularDistance > wallDepth + 2) return null;

  const width = size * 1.05;
  const height = size * 0.7;

  return { distance, screenX, screenY, width, height };
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function getKindLabel(kind) {
  const labels = {
    skill: 'Skill Exhibit',
    project: 'Project Exhibit',
    contact: 'Contact Exhibit',
    about: 'About Exhibit',
    experience: 'Experience Exhibit',
    education: 'Education Exhibit',
    research: 'Research Exhibit',
    interest: 'Interest Exhibit',
    award: 'Award Exhibit',
    certification: 'Certification Exhibit'
  };

  return labels[kind] || 'Portfolio Exhibit';
}

function drawWallCard(item, projected) {
  const x = projected.screenX - projected.width / 2;
  const y = projected.screenY - projected.height / 2;

  ctx.globalAlpha = Math.max(0.4, 1 - projected.distance / (TILE * 12));
  ctx.fillStyle = item.collected ? 'rgba(56, 92, 70, 0.82)' : 'rgba(255, 255, 255, 0.94)';
  ctx.fillRect(x, y, projected.width, projected.height);

  ctx.strokeStyle = item.collected ? '#93e2b2' : getKindColor(item.kind);
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, projected.width, projected.height);

  ctx.fillStyle = item.collected ? '#d5ffe6' : '#1f2e44';
  ctx.font = `bold ${Math.max(10, projected.height * 0.18)}px Segoe UI`;
  ctx.textAlign = 'left';
  ctx.fillText(`${item.image} ${truncateText(item.title, 24)}`, x + 8, y + 16);

  ctx.font = `${Math.max(9, projected.height * 0.14)}px Segoe UI`;
  const preview = truncateText(item.body, 34);
  ctx.fillText(preview, x + 8, y + 32);

  ctx.font = `${Math.max(8, projected.height * 0.13)}px Segoe UI`;
  ctx.fillStyle = item.collected ? '#b5f1ca' : '#3f5f89';
  ctx.fillText(getKindLabel(item.kind), x + 8, y + projected.height - 22);
  ctx.fillText(item.collected ? 'Visited Exhibit' : 'Click to open', x + 8, y + projected.height - 8);

  ctx.globalAlpha = 1;

  clickableCards.push({
    item,
    x,
    y,
    width: projected.width,
    height: projected.height,
    distance: projected.distance
  });
}

function drawCards() {
  clickableCards = [];
  const visible = [];
  for (const item of items) {
    const projected = projectCard(item);
    if (projected) visible.push({ item, projected });
  }

  visible.sort((a, b) => b.projected.distance - a.projected.distance);
  visible.forEach(({ item, projected }) => drawWallCard(item, projected));
  clickableCards.sort((a, b) => a.distance - b.distance);
}

function createSparkles(x, y) {
  for (let i = 0; i < 28; i += 1) {
    sparkles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 2.7,
      vy: (Math.random() - 0.5) * 2.7,
      life: 44,
      size: Math.random() * 2.6 + 0.8,
      color: Math.random() > 0.5 ? '#ffe26e' : '#fff'
    });
  }
}

function projectWorldPoint(x, y) {
  const dx = x - player.x;
  const dy = y - player.y;
  const distance = Math.hypot(dx, dy);
  const angleTo = Math.atan2(dy, dx);
  let relative = normalizeAngle(angleTo - player.angle);
  if (relative > Math.PI) relative -= Math.PI * 2;
  if (Math.abs(relative) > FOV / 2) return null;

  const projection = (canvas.width / 2) / Math.tan(FOV / 2);
  const screenX = canvas.width / 2 + Math.tan(relative) * projection;
  const screenY = canvas.height / 2;
  return { screenX, screenY, distance };
}

function drawSparkles() {
  sparkles = sparkles.filter((particle) => particle.life > 0);
  sparkles.forEach((particle) => {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life -= 1;

    const projected = projectWorldPoint(particle.x, particle.y);
    if (!projected) return;

    const spriteSize = Math.max(1, 8 / Math.max(projected.distance / 40, 1));
    ctx.globalAlpha = Math.max(0, particle.life / 44);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(projected.screenX, projected.screenY, spriteSize * particle.size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function tryMove(nextX, nextY) {
  if (!isWallAt(nextX, nextY)) {
    player.x = nextX;
    player.y = nextY;
  }
}

function movePlayer() {
  if (popupOpen) return;

  let turnInput = 0;
  let moveInput = 0;

  if (keys.KeyA || keys.ArrowLeft) {
    turnInput -= 1;
  }
  if (keys.KeyD || keys.ArrowRight) {
    turnInput += 1;
  }
  if (keys.KeyW || keys.ArrowUp) {
    moveInput += 1;
  }
  if (keys.KeyS || keys.ArrowDown) {
    moveInput -= 1;
  }

  if (joystick.active) {
    joystick.renderInputX += (joystick.inputX - joystick.renderInputX) * 0.28;
    joystick.renderInputY += (joystick.inputY - joystick.renderInputY) * 0.28;
  } else {
    joystick.renderInputX *= 0.7;
    joystick.renderInputY *= 0.7;
    if (Math.abs(joystick.renderInputX) < 0.01) joystick.renderInputX = 0;
    if (Math.abs(joystick.renderInputY) < 0.01) joystick.renderInputY = 0;
  }

  const joyX = joystick.renderInputX;
  const joyY = joystick.renderInputY;
  const absX = Math.abs(joyX);
  const absY = Math.abs(joyY);
  const axisBias = 0.08;

  if (absY > absX + axisBias) {
    moveInput += -joyY;
  } else if (absX > absY + axisBias) {
    turnInput += joyX;
  } else {
    moveInput += -joyY * 0.35;
    turnInput += joyX * 0.35;
  }

  turnInput = Math.max(-1, Math.min(1, turnInput));
  moveInput = Math.max(-1, Math.min(1, moveInput));

  if (Math.abs(turnInput) > 0.01) {
    player.angle += player.turnSpeed * turnInput;
  }

  player.angle = normalizeAngle(player.angle);

  if (Math.abs(moveInput) > 0.01) {
    const forwardX = Math.cos(player.angle);
    const forwardY = Math.sin(player.angle);
    const speed = player.moveSpeed * moveInput;
    const nextX = player.x + forwardX * speed;
    const nextY = player.y + forwardY * speed;
    tryMove(nextX, nextY);
  }
}

function isTouching(item) {
  return Math.hypot(player.x - item.x, player.y - item.y) < player.radius + item.radius;
}

function showPopup(item) {
  popupTitle.textContent = item.title;
  popupBody.textContent = item.body;
  popupImage.textContent = item.image;

  if (item.link) {
    popupLink.classList.remove('hidden');
    popupLink.href = item.link;
  } else {
    popupLink.classList.add('hidden');
    popupLink.removeAttribute('href');
  }

  popupBackdrop.classList.remove('hidden');
  popupOpen = true;
}

function hidePopup() {
  popupBackdrop.classList.add('hidden');
  popupOpen = false;
}

function updateProgress() {
  const collected = items.filter((item) => item.collected).length;
  progressEl.textContent = `Exhibits Viewed: ${collected} / ${items.length}`;

  if (collected === items.length) {
    popupTitle.textContent = 'Exhibition Complete!';
    popupBody.textContent = 'You viewed every exhibit in the portfolio gallery. Thanks for exploring!';
    popupImage.textContent = '🎉';
    popupLink.classList.add('hidden');
    popupBackdrop.classList.remove('hidden');
    popupOpen = true;
  }
}

function drawLegend() {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(12, 14, 390, 132);
  ctx.fillStyle = '#22344f';
  ctx.font = 'bold 14px Segoe UI';
  ctx.fillText('Portfolio Art Exhibition', 24, 36);

  ctx.font = '12px Segoe UI';
  ctx.fillText('Keyboard: W/S or ↑/↓ move, A/D or ←/→ turn', 24, 56);
  ctx.fillText('Touch: Drag fixed bottom-left joystick, tap cards to open', 24, 76);
  ctx.fillText('💼 Experience 🎓 Education 🔬 Research 🧰 Projects + more', 24, 96);
  ctx.fillText('Popup continue: Spacebar or Continue button.', 24, 116);
}

function drawMiniMap() {
  const maxMiniMapWidth = 190;
  const maxMiniMapHeight = 120;
  const scaleX = maxMiniMapWidth / (maze[0].length * TILE);
  const scaleY = maxMiniMapHeight / (maze.length * TILE);
  const scale = Math.min(scaleX, scaleY);
  const mapWidth = maze[0].length * TILE * scale;
  const mapHeight = maze.length * TILE * scale;
  const offsetX = canvas.width - mapWidth - 14;
  const offsetY = 14;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.fillRect(offsetX - 6, offsetY - 6, mapWidth + 12, mapHeight + 12);

  for (let y = 0; y < maze.length; y += 1) {
    for (let x = 0; x < maze[0].length; x += 1) {
      ctx.fillStyle = maze[y][x] === 1 ? '#33465f' : '#dce9f7';
      ctx.fillRect(offsetX + x * TILE * scale, offsetY + y * TILE * scale, TILE * scale, TILE * scale);
    }
  }

  items.forEach((item) => {
    if (item.collected) return;
    ctx.fillStyle = getKindColor(item.kind);
    ctx.beginPath();
    ctx.arc(offsetX + item.x * scale, offsetY + item.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#2e58ff';
  ctx.beginPath();
  ctx.arc(offsetX + player.x * scale, offsetY + player.y * scale, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#2e58ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(offsetX + player.x * scale, offsetY + player.y * scale);
  ctx.lineTo(
    offsetX + (player.x + Math.cos(player.angle) * 20) * scale,
    offsetY + (player.y + Math.sin(player.angle) * 20) * scale
  );
  ctx.stroke();
}

function gameLoop(time) {
  movePlayer();

  drawWalls();
  drawCards();
  drawSparkles();
  drawLegend();
  drawMiniMap();
  drawJoystickOverlay();

  requestAnimationFrame(gameLoop);
}

initializeControls();
ensureItemsAreAccessible();
updateProgress();
requestAnimationFrame(gameLoop);
