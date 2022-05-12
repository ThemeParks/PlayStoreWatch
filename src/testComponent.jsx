import React, { useEffect, useState } from 'react';

export function TestComponent() {
    const [time, setTime] = useState('');
    useEffect(() => {
        // every 10 seconds, fetch the time from /api/time
        const interval = setInterval(() => {
            fetch('/api/time')
                .then(res => res.text())
                .then(data => {
                    setTime(data);
                }
                );
        }, 10 * 1000);
        return () => clearInterval(interval);
    });

    return <>
        <h1>Test Cloudflare Deployment 🌟⏲</h1>
        <h2>{time}</h2>
    </>;
}
export default TestComponent;