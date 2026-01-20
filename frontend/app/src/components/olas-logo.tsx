export function OlasLogo({ className = "h-6" }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 120 30"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {/* Olas wordmark */}
            <text
                x="0"
                y="22"
                fontFamily="system-ui, -apple-system, sans-serif"
                fontSize="24"
                fontWeight="700"
                fill="currentColor"
                letterSpacing="-0.5"
            >
                OLAS
            </text>
        </svg>
    );
}
