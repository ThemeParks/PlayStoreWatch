import React from 'react'
import { createRoot } from 'react-dom/client';

import { TestComponent } from './testComponent';

const root = createRoot(document.getElementById('root'));

root.render(
    <React.StrictMode>
        <TestComponent timer={5} />
    </React.StrictMode>
);
