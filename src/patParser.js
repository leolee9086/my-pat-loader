/**
 * Parses the text content of a .PAT file.
 * @param {string} patTextString - The string content of the .PAT file.
 * @returns {{name: string, linesDefs: Array<object>, description?: string, error?: string}} 
 *          name: Pattern name from the PAT file.
 *          linesDefs: Array of line definition objects. Each object:
 *                     { angle, origin: [x,y], delta: [dx,dy], dashes: [d1,d2,...] }
 *                     angle is in degrees.
 *          description: Optional description from the PAT file.
 *          error: Error message if parsing fails.
 */
export function parsePatContent(patTextString) {
  const lines = patTextString.split(/\r\n|\n|\r/);
  let patternName = "untitled_pat";
  let description = "";
  const linesDefs = [];
  let headerFound = false;
  let firstLineProcessed = false; // To track if we've passed potential header area

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { 
      continue; // Skip empty lines
    }
    if (line.startsWith(';')) {
        if (headerFound || firstLineProcessed) { 
            continue;
        }
        if (!headerFound) continue; // Comments before header are just ignored.
    }


    if (!headerFound && line.startsWith('*')) {
      headerFound = true;
      firstLineProcessed = true; 
      const headerParts = line.substring(1).split(',');
      patternName = headerParts[0]?.trim();
      if (!patternName && headerParts.length > 1) { 
        patternName = "Unnamed PAT"; 
      } else if (!patternName) {
        patternName = "untitled_pat";
      }
      if (headerParts.length > 1) {
        description = headerParts.slice(1).join(',').trim();
      }
      continue;
    }
    if (line.startsWith(';')) continue; 
    
    firstLineProcessed = true; // Any non-comment, non-empty line from here means we've processed content.

    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) { // Each data line must have at least angle, ox, oy, dx, dy
      continue; 
    }
    
    const angle = parseFloat(parts[0]);
    const originX = parseFloat(parts[1]);
    const originY = parseFloat(parts[2]);
    let deltaX = parseFloat(parts[3]); 
    let deltaY = parseFloat(parts[4]); 
    if (isNaN(angle) || isNaN(originX) || isNaN(originY)) {
      // console.warn(`PAT Parse: Skipping data line with invalid numbers (angle/origin): ${line}`);
      continue;
    }
    if (isNaN(deltaX)) {
        deltaX = 0.0;
    }
    if (isNaN(deltaY)) {
        deltaY = 0.0;
    }
    
    const dashes = parts.slice(5).map(d => parseFloat(d)).filter(d => !isNaN(d)); 
    linesDefs.push({
      angle, 
      origin: [originX, originY],
      delta: [deltaX, deltaY], 
      dashes
    });
  }

  if (!headerFound && linesDefs.length > 0) {
  }
  
  // Error conditions:
  if (linesDefs.length === 0 && !headerFound) { 
    // Completely empty or only comments
    return { name: "error_pat", linesDefs: [], error: "PAT Error: No header and no line definitions found." };
  }
  if (linesDefs.length === 0 && headerFound) { 
    // Header found, but no actual line definitions followed it
    return { name: patternName, linesDefs: [], description, error: `PAT Error: Header for '${patternName}' found, but no subsequent line definitions.` };
  }

  return { name: patternName, linesDefs, description };
} 