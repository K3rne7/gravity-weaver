# Gravity Weaver

Welcome to Gravity Weaver, a fast-paced web-based game where you must navigate an ever-changing field of obstacles by inverting gravity. This project was built with React, TypeScript, and Tailwind CSS, featuring a real-time leaderboard powered by Firebase.

## Features

-   **Dynamic Gameplay**: Procedurally generated obstacles that increase in difficulty.
-   **Gravity Inversion**: Simple one-touch/click controls to flip gravity and dodge hazards.
-   **Power-Ups**: Collect shields, slow-motion timers, and score magnets to survive longer.
-   **Live Leaderboard**: Compete for the high score with a global leaderboard using Firebase Firestore.
-   **Custom Music Sync**: Upload your own audio track and watch the obstacles pulse to the beat!
-   **Bilingual Support**: Toggle between English and Italian at any time.

## Prerequisites

Before you begin, ensure you have the following installed on your system:
-   [Node.js](https://nodejs.org/) (LTS version recommended)
-   [Yarn](https://yarnpkg.com/) (or you can use `npm`, which comes with Node.js)

## Installation and Setup Guide

Follow these steps to get a local copy up and running.

### 1. Clone the Repository

First, clone the project from GitHub to your local machine.

```bash
git clone [https://github.com/TUO_USERNAME/gravity-weaver.git](https://github.com/TUO_USERNAME/gravity-weaver.git)
cd gravity-weaver
2. Install Dependencies
Install all the required project dependencies.

Bash

yarn install
or if you prefer npm:

Bash

npm install
3. Set Up Firebase (Crucial Step)
This application requires a Firebase project for its leaderboard and user authentication features. The game will not connect or save scores without it.

Create a Firebase Project:

Go to the Firebase Console.
Click on "Add project" and follow the on-screen instructions to create a new project.
Add a Web App to Your Project:

Inside your new project, click the Web icon (</>) to add a new web application.
Give your app a nickname and click "Register app".
Get Your Firebase Config:

After registering, Firebase will provide you with a firebaseConfig object. It will look like this:
JavaScript

const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
Copy this entire object.
Add the Config to the Project:

Open the public/index.html file in the project.

Just before the closing </body> tag, add a <script> tag and paste your firebaseConfig object, assigning it to a window variable like so:

HTML

<script>
  // PASTE YOUR FIREBASE CONFIG OBJECT HERE
  const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "...",
    appId: "..."
  };
  // Make it available to the React app
  window.__firebase_config = JSON.stringify(firebaseConfig);
</script>
&lt;/body>


Enable Firebase Services:

In the Firebase Console, go to the Authentication section.
Click the "Sign-in method" tab and enable the Anonymous sign-in provider.
Next, go to the Firestore Database section.
Click "Create database", start in production mode, and choose a location for your servers. You can edit the security rules later if needed.
4. Run the Application
You are now ready to start the development server!

Bash

yarn start
This will open the app in your browser, usually at http://localhost:3000. The game should now be fully functional.

Available Scripts
In the project directory, you can run:

yarn start
Runs the app in development mode. The page will reload if you make edits.

yarn build
Builds the app for production to the build folder. It correctly bundles React in production mode and optimizes the build for the best performance.

yarn test
Launches the test runner in interactive watch mode.

License
This project is licensed under the MIT License.
