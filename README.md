# Afraim's Portfolio Art Exhibition

An interactive 3D-style portfolio game built with HTML5 Canvas, CSS, and vanilla JavaScript.

The portfolio is presented as an art exhibition inside a maze. Each wall card represents a portfolio item (experience, education, projects, research, certifications, and more). Clicking/tapping a card opens a popup with full details.

## Features

- 3D-style first-person maze rendering (Canvas raycasting)
- Large, complex map with a compact top-right minimap
- Wall-mounted portfolio cards with preview text
- Click/tap card interactions with popup details and links
- Progress tracker (`Exhibits Viewed`)
- Keyboard + mouse support (desktop)
- Mobile/tablet support with fixed bottom-left joystick
- Spacebar or `Continue` button to close popup
- Fully static, no backend required

## Controls

### Desktop

- `W/S` or `↑/↓` → move forward/back
- `A/D` or `←/→` → rotate camera
- Mouse click on card → open exhibit popup
- `Spacebar` or popup `Continue` button → close popup

### Mobile / Tablet

- Fixed joystick (bottom-left, 50px margin) → move/turn
- Tap card → open exhibit popup
- Tap popup `Continue` button → close popup

## Run

1. Open `index.html` in Chrome, Edge, Firefox, or Safari.
2. Explore the gallery maze.
3. Open wall cards to view portfolio exhibits.

## Project Structure

```text
portfolio-game/
├─ index.html      # App shell + canvas + popup UI
├─ style.css       # Responsive styles
├─ game.js         # Rendering, controls, map, interactions
├─ assets/
│  ├─ images/
│  └─ sounds/
└─ README.md
```

## Customization

- Edit portfolio entries in `game.js` (`portfolioEntries` list).
- Adjust maze size with `MAZE_WIDTH` and `MAZE_HEIGHT`.
- Tune joystick feel via `maxRadius`, `deadzone`, and smoothing values.
