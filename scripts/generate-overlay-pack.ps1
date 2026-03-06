$ErrorActionPreference = 'Stop'

$outDir = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'public/overlays'
New-Item -ItemType Directory -Force $outDir | Out-Null
Get-ChildItem -Path $outDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

function Write-Svg {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Inner
  )

  $content = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>`n$Inner`n</svg>`n"
  Set-Content -Path (Join-Path $outDir $Name) -Value $content -Encoding UTF8
}

function Rotate-Group {
  param(
    [Parameter(Mandatory = $true)][int]$Rotation,
    [Parameter(Mandatory = $true)][string]$Inner
  )

  if ($Rotation -eq 0) { return $Inner }
  return "<g transform='translate(256 256) rotate($Rotation) translate(-256 -256)'>$Inner</g>"
}

function Get-RegularPolygonPoints {
  param(
    [Parameter(Mandatory = $true)][int]$Sides,
    [Parameter(Mandatory = $true)][double]$Radius,
    [double]$Cx = 256,
    [double]$Cy = 256,
    [double]$StartDeg = -90
  )

  $pts = @()
  for ($i = 0; $i -lt $Sides; $i++) {
    $ang = ($StartDeg + (360.0 * $i / $Sides)) * [Math]::PI / 180.0
    $x = [Math]::Round($Cx + $Radius * [Math]::Cos($ang), 1)
    $y = [Math]::Round($Cy + $Radius * [Math]::Sin($ang), 1)
    $pts += "$x,$y"
  }
  return ($pts -join ' ')
}

function Get-StarPoints {
  param(
    [Parameter(Mandatory = $true)][int]$Spikes,
    [Parameter(Mandatory = $true)][double]$OuterRadius,
    [Parameter(Mandatory = $true)][double]$InnerRadius,
    [double]$Cx = 256,
    [double]$Cy = 256
  )

  $pts = @()
  $total = $Spikes * 2
  for ($i = 0; $i -lt $total; $i++) {
    $r = if (($i % 2) -eq 0) { $OuterRadius } else { $InnerRadius }
    $deg = -90 + (360.0 * $i / $total)
    $ang = $deg * [Math]::PI / 180.0
    $x = [Math]::Round($Cx + $r * [Math]::Cos($ang), 1)
    $y = [Math]::Round($Cy + $r * [Math]::Sin($ang), 1)
    $pts += "$x,$y"
  }
  return ($pts -join ' ')
}

# --- Arrows ---
$arrowStyles = @(
  [pscustomobject]@{ Name = 'solid'; Width = 22; Dash = ''; Head = 'filled' },
  [pscustomobject]@{ Name = 'bold'; Width = 34; Dash = ''; Head = 'filled' },
  [pscustomobject]@{ Name = 'thin'; Width = 14; Dash = ''; Head = 'filled' },
  [pscustomobject]@{ Name = 'dashed'; Width = 20; Dash = '22 16'; Head = 'open' },
  [pscustomobject]@{ Name = 'chevron'; Width = 24; Dash = ''; Head = 'chevron' },
  [pscustomobject]@{ Name = 'hollow'; Width = 20; Dash = ''; Head = 'hollow' },
  [pscustomobject]@{ Name = 'doubleline'; Width = 12; Dash = ''; Head = 'filled' }
)

$arrowDirs = @(
  [pscustomobject]@{ Name = 'right'; Rot = 0 },
  [pscustomobject]@{ Name = 'down'; Rot = 90 },
  [pscustomobject]@{ Name = 'left'; Rot = 180 },
  [pscustomobject]@{ Name = 'up'; Rot = 270 }
)

foreach ($style in $arrowStyles) {
  foreach ($dir in $arrowDirs) {
    $shaft = if ($style.Name -eq 'doubleline') {
      "<path d='M72 236h264' fill='none' stroke='#111' stroke-width='12' stroke-linecap='round'/><path d='M72 276h264' fill='none' stroke='#111' stroke-width='12' stroke-linecap='round'/>"
    } else {
      $dashAttr = if ($style.Dash) { " stroke-dasharray='$($style.Dash)'" } else { '' }
      "<path d='M72 256h264' fill='none' stroke='#111' stroke-width='$($style.Width)' stroke-linecap='round'$dashAttr/>"
    }

    $head = switch ($style.Head) {
      'filled' { "<path d='M236 130 434 256 236 382Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" }
      'open' { "<path d='m246 132 182 124-182 124' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round' stroke-linejoin='round'/>" }
      'chevron' { "<path d='m232 130 186 126-186 126' fill='none' stroke='#111' stroke-width='30' stroke-linecap='round' stroke-linejoin='round'/>" }
      'hollow' { "<path d='M232 132 430 256 232 380Z' fill='none' stroke='#111' stroke-width='22' stroke-linejoin='round'/>" }
      Default { "<path d='M236 130 434 256 236 382Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" }
    }

    $inner = Rotate-Group -Rotation $dir.Rot -Inner "$shaft$head"
    Write-Svg -Name "arrow-$($style.Name)-$($dir.Name).svg" -Inner $inner
  }
}

$specialArrows = @(
  [pscustomobject]@{ Name = 'arrow-curve-right'; Path = "<path d='M76 362c0-122 90-206 220-206h132' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M332 78 448 156 332 234Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'arrow-curve-left'; Path = "<path d='M436 362c0-122-90-206-220-206H84' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M180 78 64 156l116 78Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'arrow-uturn-right'; Path = "<path d='M120 86v194c0 76 58 134 132 134h186' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M346 334 448 414 346 494Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'arrow-uturn-left'; Path = "<path d='M392 86v194c0 76-58 134-132 134H74' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M166 334 64 414l102 80Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'arrow-bidirectional-horizontal'; Path = "<path d='M84 256h344' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M150 144 62 256l88 112' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/><path d='m362 144 88 112-88 112' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'arrow-bidirectional-vertical'; Path = "<g transform='rotate(90 256 256)'><path d='M84 256h344' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/><path d='M150 144 62 256l88 112' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/><path d='m362 144 88 112-88 112' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/></g>" },
  [pscustomobject]@{ Name = 'arrow-split-right'; Path = "<path d='M64 256h188' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round'/><path d='M250 256c90 0 118-56 182-120' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M250 256c90 0 118 56 182 120' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M350 88 448 138 362 210Z' fill='#fff' stroke='#111' stroke-width='16'/><path d='m350 424 98-50-86-72Z' fill='#fff' stroke='#111' stroke-width='16'/>" },
  [pscustomobject]@{ Name = 'arrow-split-left'; Path = "<g transform='rotate(180 256 256)'><path d='M64 256h188' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round'/><path d='M250 256c90 0 118-56 182-120' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M250 256c90 0 118 56 182 120' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M350 88 448 138 362 210Z' fill='#fff' stroke='#111' stroke-width='16'/><path d='m350 424 98-50-86-72Z' fill='#fff' stroke='#111' stroke-width='16'/></g>" },
  [pscustomobject]@{ Name = 'arrow-zigzag-right'; Path = "<path d='m64 288 94-122 86 122 88-122 110 90' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/><path d='M366 92 448 168l-94 52Z' fill='#fff' stroke='#111' stroke-width='16'/>" },
  [pscustomobject]@{ Name = 'arrow-zigzag-left'; Path = "<g transform='rotate(180 256 256)'><path d='m64 288 94-122 86 122 88-122 110 90' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/><path d='M366 92 448 168l-94 52Z' fill='#fff' stroke='#111' stroke-width='16'/></g>" },
  [pscustomobject]@{ Name = 'arrow-swirl-right'; Path = "<path d='M118 348c-16-108 78-214 194-202 66 8 116 46 130 98' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round'/><path d='m360 170 88 76-100 56Z' fill='#fff' stroke='#111' stroke-width='16'/>" },
  [pscustomobject]@{ Name = 'arrow-swirl-left'; Path = "<g transform='rotate(180 256 256)'><path d='M118 348c-16-108 78-214 194-202 66 8 116 46 130 98' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round'/><path d='m360 170 88 76-100 56Z' fill='#fff' stroke='#111' stroke-width='16'/></g>" }
)

foreach ($spec in $specialArrows) {
  Write-Svg -Name "$($spec.Name).svg" -Inner $spec.Path
}

# --- Shapes ---
foreach ($sides in 3..12) {
  $poly = Get-RegularPolygonPoints -Sides $sides -Radius 176
  Write-Svg -Name ("shape-polygon-{0:00}-outline.svg" -f $sides) -Inner "<polygon points='$poly' fill='none' stroke='#111' stroke-width='22' stroke-linejoin='round'/>"
  Write-Svg -Name ("shape-polygon-{0:00}-fill.svg" -f $sides) -Inner "<polygon points='$poly' fill='#fff' stroke='#111' stroke-width='22' stroke-linejoin='round'/>"
}

$starDefs = @(
  [pscustomobject]@{ Spikes = 4; Outer = 184; Inner = 90 },
  [pscustomobject]@{ Spikes = 5; Outer = 184; Inner = 84 },
  [pscustomobject]@{ Spikes = 6; Outer = 184; Inner = 86 },
  [pscustomobject]@{ Spikes = 7; Outer = 182; Inner = 82 },
  [pscustomobject]@{ Spikes = 8; Outer = 184; Inner = 84 },
  [pscustomobject]@{ Spikes = 10; Outer = 182; Inner = 80 }
)

foreach ($star in $starDefs) {
  $points = Get-StarPoints -Spikes $star.Spikes -OuterRadius $star.Outer -InnerRadius $star.Inner
  Write-Svg -Name ("shape-star-{0:00}.svg" -f $star.Spikes) -Inner "<polygon points='$points' fill='#fff' stroke='#111' stroke-width='18' stroke-linejoin='round'/>"
}

$shapeExtras = @(
  [pscustomobject]@{ Name = 'shape-heart'; Inner = "<path d='M256 430 98 270c-40-42-40-112 0-154s104-42 144 0l14 14 14-14c40-42 104-42 144 0s40 112 0 154Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'shape-cloud'; Inner = "<path d='M136 368h246a82 82 0 0 0 0-164 108 108 0 0 0-204-24A78 78 0 0 0 136 368Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'shape-tag'; Inner = "<path d='M86 170h220l120 120-120 120H86Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/><circle cx='148' cy='230' r='20' fill='none' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'shape-ribbon'; Inner = "<path d='M70 166h372v112H70Z' fill='#fff' stroke='#111' stroke-width='18'/><path d='m142 278-54 100h78l36-100Zm228 0 36 100h78l-54-100Z' fill='#fff' stroke='#111' stroke-width='16' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'shape-banner'; Inner = "<path d='M52 168h408v152H52Z' fill='#fff' stroke='#111' stroke-width='20'/><path d='m52 168 74 76-74 76Zm408 0-74 76 74 76Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'shape-pill-outline'; Inner = "<rect x='60' y='168' width='392' height='176' rx='88' fill='none' stroke='#111' stroke-width='22'/>" },
  [pscustomobject]@{ Name = 'shape-pill-fill'; Inner = "<rect x='60' y='168' width='392' height='176' rx='88' fill='#fff' stroke='#111' stroke-width='22'/>" },
  [pscustomobject]@{ Name = 'shape-ring-double'; Inner = "<circle cx='256' cy='256' r='170' fill='none' stroke='#111' stroke-width='18'/><circle cx='256' cy='256' r='124' fill='none' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'shape-frame-rounded'; Inner = "<rect x='58' y='58' width='396' height='396' rx='72' fill='none' stroke='#111' stroke-width='20'/><rect x='122' y='122' width='268' height='268' rx='44' fill='none' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'shape-frame-square'; Inner = "<rect x='58' y='58' width='396' height='396' fill='none' stroke='#111' stroke-width='20'/><rect x='122' y='122' width='268' height='268' fill='none' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'shape-bracket-round'; Inner = "<path d='M184 80c-54 24-88 88-88 176s34 152 88 176' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M328 80c54 24 88 88 88 176s-34 152-88 176' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'shape-bracket-square'; Inner = "<path d='M190 84H100v344h90' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/><path d='M322 84h90v344h-90' fill='none' stroke='#111' stroke-width='20' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'shape-plus-bold'; Inner = "<path d='M208 84h96v124h124v96H304v124h-96V304H84v-96h124Z' fill='#fff' stroke='#111' stroke-width='16' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'shape-x-bold'; Inner = "<path d='M116 92 92 116l140 140L92 396l24 24 140-140 140 140 24-24-140-140 140-140-24-24-140 140Z' fill='#fff' stroke='#111' stroke-width='10' stroke-linejoin='round'/>" }
)

foreach ($shape in $shapeExtras) {
  Write-Svg -Name "$($shape.Name).svg" -Inner $shape.Inner
}

# --- Bubbles ---
$bubbleDefs = @(
  [pscustomobject]@{ Name = 'bubble-chat-left'; Inner = "<path d='M92 94h328a54 54 0 0 1 54 54v182a54 54 0 0 1-54 54H236L120 470l22-86h-50a54 54 0 0 1-54-54V148a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-right'; Inner = "<path d='M92 94h328a54 54 0 0 1 54 54v182a54 54 0 0 1-54 54h-50l22 86-116-86H92a54 54 0 0 1-54-54V148a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-up'; Inner = "<path d='M92 130h328a54 54 0 0 1 54 54v176a54 54 0 0 1-54 54H318l-62 68-62-68H92a54 54 0 0 1-54-54V184a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-down'; Inner = "<path d='M92 74h328a54 54 0 0 1 54 54v176a54 54 0 0 1-54 54H310l-54 80-54-80H92a54 54 0 0 1-54-54V128a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-round-left'; Inner = "<path d='M94 106h324a62 62 0 0 1 62 62v154a62 62 0 0 1-62 62H234l-120 86 24-86H94a62 62 0 0 1-62-62V168a62 62 0 0 1 62-62Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-round-right'; Inner = "<path d='M94 106h324a62 62 0 0 1 62 62v154a62 62 0 0 1-62 62h-44l24 86-120-86H94a62 62 0 0 1-62-62V168a62 62 0 0 1 62-62Z' fill='#fff' stroke='#111' stroke-width='20'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-spiky-left'; Inner = "<path d='M88 110h336a54 54 0 0 1 54 54v162a54 54 0 0 1-54 54H258L92 474l44-96H88a54 54 0 0 1-54-54V164a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-chat-spiky-right'; Inner = "<path d='M88 110h336a54 54 0 0 1 54 54v162a54 54 0 0 1-54 54h-48l44 96-166-94H88a54 54 0 0 1-54-54V164a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-thought-left'; Inner = "<path d='M124 190c0-66 60-118 132-118h24c72 0 132 52 132 118s-60 118-132 118H256c-72 0-132-52-132-118Z' fill='#fff' stroke='#111' stroke-width='20'/><circle cx='156' cy='360' r='28' fill='#fff' stroke='#111' stroke-width='16'/><circle cx='120' cy='414' r='18' fill='#fff' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'bubble-thought-right'; Inner = "<path d='M124 190c0-66 60-118 132-118h24c72 0 132 52 132 118s-60 118-132 118H256c-72 0-132-52-132-118Z' fill='#fff' stroke='#111' stroke-width='20'/><circle cx='356' cy='360' r='28' fill='#fff' stroke='#111' stroke-width='16'/><circle cx='392' cy='414' r='18' fill='#fff' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'bubble-thought-up'; Inner = "<ellipse cx='256' cy='222' rx='176' ry='122' fill='#fff' stroke='#111' stroke-width='20'/><circle cx='256' cy='396' r='32' fill='#fff' stroke='#111' stroke-width='16'/><circle cx='256' cy='454' r='18' fill='#fff' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'bubble-thought-down'; Inner = "<ellipse cx='256' cy='230' rx='176' ry='122' fill='#fff' stroke='#111' stroke-width='20'/><circle cx='256' cy='82' r='22' fill='#fff' stroke='#111' stroke-width='12'/><circle cx='256' cy='44' r='14' fill='#fff' stroke='#111' stroke-width='10'/>" },
  [pscustomobject]@{ Name = 'bubble-shout-left'; Inner = "<path d='M84 122h312l74-52-24 92 32 72-84 16-24 94-78-56H84a52 52 0 0 1-52-52V174a52 52 0 0 1 52-52Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-shout-right'; Inner = "<path d='M428 122H116l-74-52 24 92-32 72 84 16 24 94 78-56h208a52 52 0 0 0 52-52V174a52 52 0 0 0-52-52Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-caption-box'; Inner = "<rect x='66' y='154' width='380' height='204' fill='#fff' stroke='#111' stroke-width='20'/><path d='M196 358h120l-60 86Z' fill='#fff' stroke='#111' stroke-width='18' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-caption-round'; Inner = "<rect x='66' y='154' width='380' height='204' rx='36' fill='#fff' stroke='#111' stroke-width='20'/><path d='M196 358h120l-60 86Z' fill='#fff' stroke='#111' stroke-width='18' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'bubble-whisper-left'; Inner = "<path d='M96 118h320a54 54 0 0 1 54 54v158a54 54 0 0 1-54 54H236L108 468l20-84H96a54 54 0 0 1-54-54V172a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='18' stroke-dasharray='12 10'/>" },
  [pscustomobject]@{ Name = 'bubble-whisper-right'; Inner = "<path d='M96 118h320a54 54 0 0 1 54 54v158a54 54 0 0 1-54 54h-32l20 84-128-84H96a54 54 0 0 1-54-54V172a54 54 0 0 1 54-54Z' fill='#fff' stroke='#111' stroke-width='18' stroke-dasharray='12 10'/>" }
)

foreach ($bubble in $bubbleDefs) {
  Write-Svg -Name "$($bubble.Name).svg" -Inner $bubble.Inner
}

# --- Stylings ---
$styleDefs = @(
  [pscustomobject]@{ Name = 'style-underline-swoop'; Inner = "<path d='M58 312c120 54 260 54 396 0' fill='none' stroke='#111' stroke-width='24' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-underline-double'; Inner = "<path d='M62 290h388' fill='none' stroke='#111' stroke-width='18' stroke-linecap='round'/><path d='M84 334h344' fill='none' stroke='#111' stroke-width='14' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-speed-lines-right'; Inner = "<path d='M62 128h192M62 202h264M62 276h320M62 350h230' fill='none' stroke='#111' stroke-width='18' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-speed-lines-left'; Inner = "<g transform='rotate(180 256 256)'><path d='M62 128h192M62 202h264M62 276h320M62 350h230' fill='none' stroke='#111' stroke-width='18' stroke-linecap='round'/></g>" },
  [pscustomobject]@{ Name = 'style-speed-lines-up'; Inner = "<g transform='rotate(270 256 256)'><path d='M62 128h192M62 202h264M62 276h320M62 350h230' fill='none' stroke='#111' stroke-width='18' stroke-linecap='round'/></g>" },
  [pscustomobject]@{ Name = 'style-speed-lines-down'; Inner = "<g transform='rotate(90 256 256)'><path d='M62 128h192M62 202h264M62 276h320M62 350h230' fill='none' stroke='#111' stroke-width='18' stroke-linecap='round'/></g>" },
  [pscustomobject]@{ Name = 'style-circle-scribble'; Inner = "<path d='M90 260c8-122 120-206 234-184 96 18 168 100 156 196-12 98-102 168-206 166-110-2-196-78-206-178 0-2 0-4 1-6Z' fill='none' stroke='#111' stroke-width='16' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-oval-scribble'; Inner = "<path d='M62 268c8-92 114-160 238-150 110 8 194 72 190 150-4 86-106 154-228 154-130 0-210-74-200-154Z' fill='none' stroke='#111' stroke-width='16' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-highlight-swipe-1'; Inner = "<path d='M58 246c128-58 254-64 396-22v70c-146-32-274-24-396 24Z' fill='#fff176' stroke='#111' stroke-width='12' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'style-highlight-swipe-2'; Inner = "<path d='M54 206c124-24 264-24 404 6v54c-138-22-270-20-404 8Z' fill='#ffe066' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'style-highlight-swipe-3'; Inner = "<path d='M60 286c120-26 252-34 390-10v52c-136-18-264-10-390 16Z' fill='#ffd54f' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'style-brush-stroke-1'; Inner = "<path d='M54 250c86-74 304-82 404-26l-4 74c-108-24-310-20-398 32Z' fill='#fff' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'style-brush-stroke-2'; Inner = "<path d='M66 184c96 18 212 20 382-14l-8 72c-154 26-270 26-384 10Z' fill='#fff' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'style-brush-stroke-3'; Inner = "<path d='M66 328c118-56 246-78 380-42l-4 72c-136-24-260-10-378 34Z' fill='#fff' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'style-stars-cluster'; Inner = "<path d='m116 90 14 36 36 14-36 14-14 36-14-36-36-14 36-14Zm270 48 18 46 46 18-46 18-18 46-18-46-46-18 46-18Zm-138 170 14 36 36 14-36 14-14 36-14-36-36-14 36-14Z' fill='#fff' stroke='#111' stroke-width='12' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'style-rays-sunburst'; Inner = "<g stroke='#111' stroke-width='18' stroke-linecap='round' fill='none'><path d='M256 44v82'/><path d='m256 386v82'/><path d='M44 256h82'/><path d='M386 256h82'/><path d='m96 96 58 58'/><path d='m358 358 58 58'/><path d='m96 416 58-58'/><path d='m358 154 58-58'/></g><circle cx='256' cy='256' r='86' fill='#fff' stroke='#111' stroke-width='16'/>" },
  [pscustomobject]@{ Name = 'style-crosshatch'; Inner = "<path d='M74 88 438 452M118 88 482 452M30 88 394 452M74 452 438 88M118 452 482 88M30 452 394 88' fill='none' stroke='#111' stroke-width='10' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-wave-line'; Inner = "<path d='M46 256c46-64 92-64 138 0s92 64 138 0 92-64 138 0' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-zigzag-wide'; Inner = "<path d='m44 308 74-112 74 112 74-112 74 112 74-112 74 112' fill='none' stroke='#111' stroke-width='22' stroke-linecap='round' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'style-frame-corners-thin'; Inner = "<path d='M68 170V68h102M342 68h102v102M444 342v102H342M170 444H68V342' fill='none' stroke='#111' stroke-width='14' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-frame-corners-thick'; Inner = "<path d='M68 196V68h128M316 68h128v128M444 316v128H316M196 444H68V316' fill='none' stroke='#111' stroke-width='28' stroke-linecap='round'/>" },
  [pscustomobject]@{ Name = 'style-dot-grid'; Inner = "<g fill='#fff' stroke='#111' stroke-width='6'><circle cx='94' cy='94' r='8'/><circle cx='142' cy='94' r='8'/><circle cx='190' cy='94' r='8'/><circle cx='238' cy='94' r='8'/><circle cx='286' cy='94' r='8'/><circle cx='334' cy='94' r='8'/><circle cx='382' cy='94' r='8'/><circle cx='430' cy='94' r='8'/><circle cx='94' cy='142' r='8'/><circle cx='142' cy='142' r='8'/><circle cx='190' cy='142' r='8'/><circle cx='238' cy='142' r='8'/><circle cx='286' cy='142' r='8'/><circle cx='334' cy='142' r='8'/><circle cx='382' cy='142' r='8'/><circle cx='430' cy='142' r='8'/><circle cx='94' cy='190' r='8'/><circle cx='142' cy='190' r='8'/><circle cx='190' cy='190' r='8'/><circle cx='238' cy='190' r='8'/><circle cx='286' cy='190' r='8'/><circle cx='334' cy='190' r='8'/><circle cx='382' cy='190' r='8'/><circle cx='430' cy='190' r='8'/></g>" },
  [pscustomobject]@{ Name = 'style-confetti'; Inner = "<rect x='92' y='96' width='20' height='44' fill='#fff' stroke='#111' stroke-width='8'/><rect x='150' y='188' width='20' height='44' fill='#fff' stroke='#111' stroke-width='8' transform='rotate(20 160 210)'/><rect x='242' y='132' width='20' height='44' fill='#fff' stroke='#111' stroke-width='8' transform='rotate(-16 252 154)'/><rect x='322' y='216' width='20' height='44' fill='#fff' stroke='#111' stroke-width='8' transform='rotate(28 332 238)'/><rect x='404' y='124' width='20' height='44' fill='#fff' stroke='#111' stroke-width='8' transform='rotate(-26 414 146)'/><circle cx='104' cy='336' r='14' fill='#fff' stroke='#111' stroke-width='8'/><circle cx='198' cy='406' r='14' fill='#fff' stroke='#111' stroke-width='8'/><circle cx='292' cy='352' r='14' fill='#fff' stroke='#111' stroke-width='8'/><circle cx='378' cy='402' r='14' fill='#fff' stroke='#111' stroke-width='8'/>" }
)

foreach ($style in $styleDefs) {
  Write-Svg -Name "$($style.Name).svg" -Inner $style.Inner
}

# --- Flames ---
$flameDefs = @(
  [pscustomobject]@{ Name = 'flame-small'; Inner = "<path d='M256 446c86 0 142-64 142-142 0-76-52-116-92-164-6 44-24 78-52 108-8-36-32-66-64-96-16 38-74 88-74 158 0 78 56 136 140 136Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/><path d='M252 402c48 0 80-36 80-82 0-30-16-54-40-78-2 24-12 42-26 58-8-18-20-32-34-46-12 26-28 42-28 70 0 46 18 78 48 78Z' fill='#ffd36b' stroke='#111' stroke-width='14' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'flame-medium'; Inner = "<path d='M258 468c108 0 176-78 176-174 0-96-72-150-116-208-10 52-30 96-62 132-12-42-38-78-76-114-24 54-106 114-106 210 0 96 70 154 184 154Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/><path d='M258 416c64 0 108-46 108-108 0-44-24-78-60-112-4 30-16 56-36 78-10-24-26-42-44-60-24 28-42 54-42 94 0 58 28 108 74 108Z' fill='#ffb347' stroke='#111' stroke-width='14' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'flame-tall'; Inner = "<path d='M258 472c112 0 182-80 182-180 0-108-78-162-126-232-8 64-34 116-66 156-8-56-42-96-80-134-28 70-114 132-114 220 0 100 78 170 204 170Z' fill='#fff' stroke='#111' stroke-width='20' stroke-linejoin='round'/><path d='M258 420c70 0 116-52 116-122 0-46-22-84-64-124-6 34-20 64-40 86-10-28-28-50-52-74-30 34-46 66-46 104 0 74 40 130 86 130Z' fill='#ff9d2e' stroke='#111' stroke-width='14' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'flame-wide'; Inner = "<path d='M256 460c112 0 188-76 188-176 0-90-70-150-126-212-8 56-34 98-66 138-10-42-38-72-76-106-26 58-116 126-116 212 0 96 76 144 196 144Z' fill='#fff' stroke='#111' stroke-width='20'/><path d='M256 414c66 0 114-50 114-114 0-50-28-90-64-126-4 34-20 62-40 84-10-28-26-48-48-68-30 36-46 68-46 108 0 66 44 116 84 116Z' fill='#ffb84d' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'flame-dual'; Inner = "<path d='M170 452c64 0 114-44 114-110 0-64-48-98-82-138-10 34-20 58-38 84-6-26-22-48-44-68-14 36-52 74-52 124 0 62 42 108 102 108Z' fill='#fff' stroke='#111' stroke-width='18'/><path d='M334 452c64 0 114-44 114-110 0-64-48-98-82-138-10 34-20 58-38 84-6-26-22-48-44-68-14 36-52 74-52 124 0 62 42 108 102 108Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'flame-comet-right'; Inner = "<path d='M52 292c122-8 214-54 296-160 38 22 62 60 62 102 0 76-62 138-138 138-74 0-128-34-220-80Z' fill='#fff' stroke='#111' stroke-width='18' stroke-linejoin='round'/><path d='M286 140c72 0 130 58 130 130s-58 130-130 130-130-58-130-130 58-130 130-130Z' fill='#ffb347' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'flame-comet-left'; Inner = "<g transform='rotate(180 256 256)'><path d='M52 292c122-8 214-54 296-160 38 22 62 60 62 102 0 76-62 138-138 138-74 0-128-34-220-80Z' fill='#fff' stroke='#111' stroke-width='18' stroke-linejoin='round'/><path d='M286 140c72 0 130 58 130 130s-58 130-130 130-130-58-130-130 58-130 130-130Z' fill='#ffb347' stroke='#111' stroke-width='14'/></g>" },
  [pscustomobject]@{ Name = 'flame-torch'; Inner = "<rect x='220' y='356' width='72' height='112' rx='12' fill='#fff' stroke='#111' stroke-width='14'/><path d='M256 362c66 0 112-54 112-124 0-56-44-98-80-146-6 38-24 74-48 98-8-30-24-54-44-76-16 40-58 84-58 128 0 74 50 120 118 120Z' fill='#fff' stroke='#111' stroke-width='18'/><path d='M256 324c42 0 70-34 70-78 0-34-20-58-40-84-4 22-14 38-24 52-8-14-18-26-28-36-14 22-24 38-24 62 0 44 22 84 46 84Z' fill='#ffcc66' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'flame-jet'; Inner = "<path d='M64 256h188c54 0 90-28 128-86v172c-38-58-74-86-128-86Z' fill='#fff' stroke='#111' stroke-width='16'/><path d='M274 200c68 0 122 56 122 122s-54 122-122 122V200Z' fill='#ffb347' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'flame-burst'; Inner = "<path d='M256 52 292 124l82-18 22 80 78 20-44 70 44 70-78 20-22 80-82-18-36 72-36-72-82 18-22-80-78-20 44-70-44-70 78-20 22-80 82 18Z' fill='#fff' stroke='#111' stroke-width='16'/><circle cx='256' cy='276' r='92' fill='#ffb347' stroke='#111' stroke-width='14'/>" },
  [pscustomobject]@{ Name = 'flame-magic'; Inner = "<path d='M258 460c96 0 162-72 162-166 0-90-62-146-112-206-8 54-26 96-52 132-12-40-34-74-68-106-22 54-96 120-96 196 0 86 68 150 166 150Z' fill='#fff' stroke='#111' stroke-width='20'/><path d='m256 156 20 42 46 6-34 32 8 46-40-22-40 22 8-46-34-32 46-6Z' fill='#e0d4ff' stroke='#111' stroke-width='12'/>" },
  [pscustomobject]@{ Name = 'flame-trail'; Inner = "<path d='M76 300c58-40 132-62 208-44 58 14 104 48 152 100-84-20-150-14-216 10-64 22-112 28-172 6 12-28 20-46 28-72Z' fill='#fff' stroke='#111' stroke-width='16' stroke-linejoin='round'/><path d='M334 178c40 18 70 50 94 96-58-10-94 4-130 24 4-46 14-84 36-120Z' fill='#ffb347' stroke='#111' stroke-width='14' stroke-linejoin='round'/>" },
  [pscustomobject]@{ Name = 'flame-scorch-mark'; Inner = "<path d='M84 320c66-40 122-44 172-28 58 20 104 20 170-10 2 54-26 98-70 124-46 28-106 34-162 18-54-16-94-52-110-104Z' fill='#fff' stroke='#111' stroke-width='16'/>" },
  [pscustomobject]@{ Name = 'flame-embers'; Inner = "<circle cx='102' cy='358' r='20' fill='#fff' stroke='#111' stroke-width='10'/><circle cx='170' cy='302' r='16' fill='#fff' stroke='#111' stroke-width='10'/><circle cx='236' cy='370' r='18' fill='#fff' stroke='#111' stroke-width='10'/><circle cx='304' cy='306' r='14' fill='#fff' stroke='#111' stroke-width='10'/><circle cx='372' cy='358' r='20' fill='#fff' stroke='#111' stroke-width='10'/><circle cx='410' cy='292' r='12' fill='#fff' stroke='#111' stroke-width='8'/>" },
  [pscustomobject]@{ Name = 'flame-smoke-puff-1'; Inner = "<path d='M150 388h208a74 74 0 0 0 0-148 98 98 0 0 0-184-20A66 66 0 0 0 150 388Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'flame-smoke-puff-2'; Inner = "<path d='M128 394h252a78 78 0 0 0 0-156 102 102 0 0 0-194-24A70 70 0 0 0 128 394Z' fill='#fff' stroke='#111' stroke-width='18'/>" },
  [pscustomobject]@{ Name = 'flame-smoke-puff-3'; Inner = "<path d='M146 400h220a72 72 0 0 0 0-144 94 94 0 0 0-176-18A64 64 0 0 0 146 400Z' fill='#fff' stroke='#111' stroke-width='18'/>" }
)

foreach ($flame in $flameDefs) {
  Write-Svg -Name "$($flame.Name).svg" -Inner $flame.Inner
}

Write-Host 'Overlay pack generation complete.'
