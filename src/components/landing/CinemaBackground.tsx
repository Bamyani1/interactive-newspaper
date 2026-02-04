import React from "react";
import Image from "next/image";

export function CinemaBackground() {
    return (
        <div className="cinema-bg">
            <div className="cinema-map">
                <Image
                    src="/landing-photos/default (3).jpg"
                    alt="Vintage Campus Scene"
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
