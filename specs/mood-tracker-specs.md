# mood tracker

Design and add an aesthetic mood tab to the UI for user to track mood.

## mechanics
- each day, user can choose something to represent their mood that day
- mood refers to how 'good' they felt about the day, on a scale of 1-5 (but the scale can be represented by colours, objects etc)
- the mood should be saved somewhere for the user to view on a week/month/year basis
    - suggest the best way to store this, via DB or cache in browser. the suggested method should not require any costs to be incurred
    - viewing at scale will give users an idea of how their mood changes from day to day, and whether they spend most of their time in positive or negative mood
    - the historical moods should be able to load quickly, without much overhead or too much cache
- the user should be allowed to edit their selected mood from previous days

## design guidelines
- the design should be aesthetic and minimalistic, similar to the rest of the platform
- ideally, there is a creative aspect to the logging, so it is not mundane for the user to use
- the inspiration from this is mood trackers present in bullet journal systems
