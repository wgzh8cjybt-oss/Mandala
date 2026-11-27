# Иконки интерфейса вместо эмодзи. Каждая — SVG 24x24, рисуется как маска и красится цветом темы.
# Семейства: wh (Warhammer 40K и цветовые палитры), op (One Piece), sc (Scrooge Gold).
# Все рисунки оригинальные: общие предметы и геометрия, без персонажей и фирменных знаков.

def rot(tag, angles, cx=12, cy=12):
    return ''.join(tag.replace('/>', f" transform='rotate({a} {cx} {cy})'/>") for a in angles)

# --- общие значки (одинаковые силуэты во всех семействах) ---
COMMON = {
    'flame': "<path fill-rule='evenodd' d='M12.6 2C13.4 6.2 18 8.6 18 14.3a6 6 0 0 1-12 0c0-2.5 1.2-4.1 2.6-5.5.1 1.4.8 2.4 1.8 2.8C10 8 10.6 4.6 12.6 2zM12 20a2.6 2.6 0 0 1-2.6-2.7c0-1.7 1.3-2.3 2.1-3.5.9 1.1 3.1 1.9 3.1 3.5A2.6 2.6 0 0 1 12 20z'/>",
    'crown': "<path d='M3 8l4.5 4L12 4l4.5 8L21 8l-2 11H5zM5 20.5h14V22H5z'/>",
    'shield': "<path fill-rule='evenodd' d='M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zm0 3.5L7 7.3V11c0 3.2 2 6 5 7.5 3-1.5 5-4.3 5-7.5V7.3z'/><path d='M12 8l2 3-2 5-2-5z'/>",
    'key': "<g transform='rotate(45 12 12)'><path fill-rule='evenodd' d='M12 1.5a4.5 4.5 0 0 1 1.5 8.75V22h-3V10.25A4.5 4.5 0 0 1 12 1.5zm0 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM13.5 15h2.5v2h-2.5zM13.5 19h2v2h-2z'/></g>",
    'gem': "<path fill-rule='evenodd' d='M7 3h10l5 6-10 13L2 9zM9.5 9L12 17l2.5-8z'/>",
    'book': "<path fill-rule='evenodd' d='M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.5 3v1.5h9V6zm0 3.5V11h9V9.5z'/>",
    'map': "<path fill-rule='evenodd' d='M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zM8.5 3.2h1v15.6h-1zM14.5 5.2h1V21h-1z'/>",
}

# --- значки, у которых силуэт зависит от темы ---
WH = {
    'target': "<path fill-rule='evenodd' d='M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z'/><circle cx='12' cy='12' r='2.2'/><path d='M12 .5l2 3.2h-4zM23.5 12l-3.2 2v-4zM12 23.5l-2-3.2h4zM.5 12l3.2-2v4z'/>",
    'scroll': "<path fill-rule='evenodd' d='M5 3h14a1.5 1.5 0 0 1 0 3H5a1.5 1.5 0 0 1 0-3zM6.5 7.5h11V17h-11zM5 18h14a1.5 1.5 0 0 1 0 3H5a1.5 1.5 0 0 1 0-3zM9 10h6v1.2H9zM9 12.5h6v1.2H9zM9 15h4v1.2H9z'/>",
    'relic': "<path fill-rule='evenodd' d='M12 2C7 2 4 6 4 11v6l3 3h2v-3h6v3h2l3-3v-6c0-5-3-9-8-9zM7 10h10v3H7zM9.5 15h1v2h-1zM13.5 15h1v2h-1z'/>",
    'gear': "<path fill-rule='evenodd' d='M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'/>" + rot("<rect x='10.5' y='1.5' width='3' height='4.5'/>", range(0, 360, 45)),
    'skull': "<path fill-rule='evenodd' d='M12 2C7.6 2 4.5 5.1 4.5 9.2c0 2.3 1 4 2.5 5.2V18c0 .8.7 1.5 1.5 1.5H9V22h2v-2.5h2V22h2v-2.5h.5c.8 0 1.5-.7 1.5-1.5v-3.6c1.5-1.2 2.5-2.9 2.5-5.2C19.5 5.1 16.4 2 12 2zM8.7 8.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6.6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13l1.3 2.4h-2.6z'/>",
    'star': "<path d='M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z'/>",
    'sword': "<path d='M12 1l2 3.5v10h-4v-10zM6 15h12v2.5H6zM10.8 17.5h2.4V21h-2.4zM9.5 21h5v1.5h-5z'/>",
}
OP = {
    'target': "<path fill-rule='evenodd' d='M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z'/><circle cx='12' cy='12' r='2.4'/>"
              + rot("<rect x='11.1' y='1.8' width='1.8' height='20.4' rx='.9'/>", (0, 45, 90, 135))
              + rot("<circle cx='12' cy='2.1' r='1.5'/>", range(0, 360, 45)),
    'scroll': "<path fill-rule='evenodd' d='M5 3h14a1.5 1.5 0 0 1 0 3H5a1.5 1.5 0 0 1 0-3zM6.5 7.5h11V17h-11zM5 18h14a1.5 1.5 0 0 1 0 3H5a1.5 1.5 0 0 1 0-3zM9.5 9.5L10.5 8.5 12 10 13.5 8.5 14.5 9.5 13 11 14.5 12.5 13.5 13.5 12 12 10.5 13.5 9.5 12.5 11 11z'/>",
    'relic': "<path fill-rule='evenodd' d='M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3H4zM3 12.5h18V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10.5 14.5V18h3v-3.5z'/>",
    'gear': "<g fill='none' stroke='#000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='4.5' r='2'/><path d='M12 6.5V21M8 9.5h8M4.5 13.5c.3 4 3.5 7 7.5 7s7.2-3 7.5-7M4.5 13.5l-1.5 2M19.5 13.5l1.5 2'/></g>",
    'skull': "<path fill-rule='evenodd' d='M12 4C8 4 6 6.5 6 10v1.5H2.5c0 2.7 4 4.5 9.5 4.5s9.5-1.8 9.5-4.5H18V10c0-3.5-2-6-6-6zM7.5 10.2h9V12h-9z'/>",
    'star': "<path d='M12 2l2.9 6.3 6.8.8-5 4.7 1.3 6.8-6-3.4-6 3.4 1.3-6.8-5-4.7 6.8-.8z'/>",
    'sword': "<g fill='none' stroke='#000' stroke-linecap='round' stroke-linejoin='round'><path d='M19.5 4.5C13 6 8.5 10.5 7.5 16.5' stroke-width='3.2'/><path d='M4.5 15l6 3.5' stroke-width='2.4'/><path d='M7.5 17.5L5 21' stroke-width='2.8'/></g>",
}
SC = {
    'target': "<path fill-rule='evenodd' d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z'/><path d='M12 6.5l4.5 5.5-4.5 5.5L7.5 12z'/>",
    'scroll': "<path fill-rule='evenodd' d='M2 6h20v12H2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4.5 8.5V10H6V8.5zM18 14v1.5h1.5V14z'/>",
    'relic': "<path fill-rule='evenodd' d='M9 2h6l-1.5 3C17 6.5 19.5 10 19.5 14c0 4.4-3.4 8-7.5 8s-7.5-3.6-7.5-8c0-4 2.5-7.5 6-9zM12 10l3 4-3 4-3-4z'/>",
    'gear': "<path fill-rule='evenodd' d='M3 3h18v16H3zM12 6.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'/><rect x='5' y='19.5' width='3' height='2'/><rect x='16' y='19.5' width='3' height='2'/>",
    'skull': "<path fill-rule='evenodd' d='M7 3h10v10H7zM2.5 14h19v2a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16zM7 10h10v1.8H7z'/>",
    'star': "<path fill-rule='evenodd' d='M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM12 7l1.3 3.4 3.7.2-2.9 2.3 1 3.5L12 14.4l-3.1 2.1 1-3.5-2.9-2.3 3.7-.2z'/>",
    'sword': "<g fill='none' stroke='#000' stroke-width='2.4' stroke-linecap='round'><path d='M12 21.5V8.5a4.5 4.5 0 1 0-9 0'/></g>",
}

# --- служебные значки (линии); стиль штриха зависит от темы ---
UTIL = {
    'note': 'M4 4h16v12h-9l-5 4v-4H4zM8 8.5h8M8 12h5',
    'plus': 'M12 5v14M5 12h14',
    'close': 'M6 6l12 12M18 6L6 18',
    'check': 'M4 12.5l5 5L20 6.5',
    'chevl': 'M15 5l-7 7 7 7',
    'chevr': 'M9 5l7 7-7 7',
    'trash': 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    'lock': 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3M12 15v3',
    'unlock': 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 7.5-2M12 15v3',
    'cloudup': 'M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18zM12 21v-7M9 16.5l3-3 3 3',
    'clouddown': 'M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18zM12 13.5v7.500M9 18l3 3 3-3',
    'download': 'M12 4v11M7 11l5 5 5-5M5 20h14',
    'upload': 'M12 16V5M7 9l5-5 5 5M5 20h14',
    'copy': 'M8 8h12v12H8zM5 16V4h11',
    'paste': 'M9 4h6v3H9zM7 6H5v15h14V6h-2M9 12h6M9 16h4',
    'undo': 'M8 7L4 11l4 4M4 11h10a5 5 0 0 1 0 10h-4',
    'warn': 'M12 3L2 20h20zM12 10v5M12 17.5v.5',
    'palette': 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5 0-2.5 1.5-1 3-1c2 0 4-1 4-3.5A9 9 0 0 0 12 3zM7.5 11.5v.1M10 7.5v.1M14.5 7.5v.1M17 11v.1',
    'sparkle': 'M12 3v6M12 15v6M3 12h6M15 12h6M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
    'disk': 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    'info': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.1',
    'chart': 'M5 20v-7M12 20V5M19 20v-10M3 20h18',
    'calendar': 'M4 6h16v14H4zM4 10.5h16M8 3v5M16 3v5M8 14.5h.1M12 14.5h.1M16 14.5h.1M8 17.5h.1M12 17.5h.1',
    'cart': 'M3 4h3l2.4 11h10.2L21 7H7M10 20v.1M17 20v.1',
    'clock': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5.2l3.2 2',
    'flag': 'M5 21V4M5 4h12l-2.5 4L17 12H5',
    'cube': 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9',
    'bolt': 'M13 3L5 14h6l-1 7 8-11h-6z',
}
STROKE = {
    'wh': "stroke-width='2' stroke-linecap='square' stroke-linejoin='miter'",
    'sc': "stroke-width='2' stroke-linecap='square' stroke-linejoin='miter'",
    'op': "stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'",
}
FAMILY = {'wh': WH, 'op': OP, 'sc': SC}

def icon_svg(fam, key):
    if key in FAMILY[fam]:
        body = FAMILY[fam][key]
    elif key in COMMON:
        body = COMMON[key]
    else:
        body = f"<g fill='none' stroke='#000' {STROKE[fam]}><path d='{UTIL[key]}'/></g>"
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>{body}</svg>"

ALL_KEYS = sorted(set(WH) | set(COMMON) | set(UTIL))
