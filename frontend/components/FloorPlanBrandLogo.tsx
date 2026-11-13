import React from "react";
import Svg, { Rect, Path } from "react-native-svg";

interface FloorPlanBrandLogoProps {
  size?: number;
}

/**
 * FloorPlanBrandLogo
 * Renders the exact orange rounded-square logo from the visual reference:
 * - Orange rounded-square background (#FF5E1A)
 * - White receipt on the left with a serrated/jagged bottom tear and 4 horizontal line cuts
 * - White fork in the middle placed vertically
 * - White spoon on the right placed vertically
 */
export const FloorPlanBrandLogo: React.FC<FloorPlanBrandLogoProps> = ({ size = 42 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {/* Orange rounded-square background */}
      <Rect width="100" height="100" rx="22" fill="#FF5E1A" />

      {/* 
        Receipt/Bill on the left:
        Outer boundary with serrated/zigzag bottom tear
      */}
      <Path
        d="M 18 20 
           H 54 
           V 78 
           L 49.5 73.5 
           L 45 78 
           L 40.5 73.5 
           L 36 78 
           L 31.5 73.5 
           L 27 78 
           L 22.5 73.5 
           L 18 78 
           Z"
        fill="#FFFFFF"
      />

      {/* 4 clearly visible horizontal lines cut into the receipt */}
      {/* Line 1 */}
      <Rect x="25" y="30" width="22" height="4" rx="2" fill="#FF5E1A" />
      {/* Line 2 */}
      <Rect x="25" y="39" width="18" height="4" rx="2" fill="#FF5E1A" />
      {/* Line 3 */}
      <Rect x="25" y="48" width="22" height="4" rx="2" fill="#FF5E1A" />
      {/* Line 4 */}
      <Rect x="25" y="57" width="15" height="4" rx="2" fill="#FF5E1A" />

      {/* 
        Fork placed vertically in the middle:
        - 3 prongs with gaps
        - Fork shoulder and vertical handle with rounded base
      */}
      <Path
        d="M 60 25 
           V 40 
           C 60 45.5 63 47.5 64.5 48 
           V 76 
           C 64.5 77.5 65.5 78 66 78 
           C 66.5 78 67.5 77.5 67.5 76 
           V 48 
           C 69 47.5 72 45.5 72 40 
           V 25 
           H 69.5 
           V 36 
           H 68 
           V 25 
           H 64 
           V 36 
           H 62.5 
           V 25 
           Z"
        fill="#FFFFFF"
      />

      {/* 
        Spoon placed vertically on the right:
        - Smooth oval bowl
        - Vertical handle with rounded base
      */}
      <Path
        d="M 78 35 
           C 78 26 88 26 88 35 
           C 88 43 84.5 46.5 84 48 
           V 76 
           C 84 77.5 83 78 82 78 
           C 81 78 80 77.5 80 76 
           V 48 
           C 79.5 46.5 78 43 78 35 
           Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
};

export default FloorPlanBrandLogo;
