import React from "react";
import Image from "next/image";

export function CinemaBackground() {
    return (
        <div className="cinema-bg">
            <div className="cinema-map">
                <Image
                    src="/backgrounds/background.png"
                    alt="University Hall tower framed by cherry blossoms"
                    fill
                    style={{ objectFit: "cover" }}
                    sizes="100vw"
                    priority
                    quality={95}
                />
            </div>
            {/* Dark overlay for readability */}
            <div className="cinema-overlay" />
        </div>
    );
}
