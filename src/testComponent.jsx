import React, { useEffect, useState } from 'react';

export function TestComponent({ timer = 10 }) {
    const [counter, setCounter] = useState('');

    useEffect(() => {
        const getCounter = () => {
            fetch('/api/counter')
                .then(res => res.text())
                .then(data => {
                    setCounter(data);
                }
                );
        };

        // every x seconds, fetch the counter from /api/counter
        const interval = setInterval(getCounter, timer * 1000);
        getCounter(); // update immediately too
        return () => clearInterval(interval);
    }, []);

    return <>
        <h1>Test Cloudflare Deployment 🌟⏲</h1>
        <h2>{counter}</h2>
    </>;
}
export default TestComponent;