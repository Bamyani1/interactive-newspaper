import React from "react";

export function CinemaBackground() {
    return (
        <div className="cinema-bg">
            <div className="cinema-map">
                <object
                    type="image/svg+xml"
                    data="/shape/doodle-animated.svg"
                    aria-label="OWU campus doodle pattern"
                    className="cinema-map-svg"
                />
            </div>
            {/* Dark gradient overlay */}
            <div className="cinema-overlay" />
            {/* Heavy vignette for cinematic framing */}
            <div className="cinema-vignette" />
            {/* Film grain texture */}
            <div className="cinema-grain" />
        </div>
    );
}
