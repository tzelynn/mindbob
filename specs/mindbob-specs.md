# mindbob

mindbob is a wellness platform that refreshes twice a day, providing viewers with a feel-good message.

## Purpose
- The purpose of this platform is to provide viewers with timely notes of encouragement, entertainment or advice.
- The inspiration behind this is random life lessons that people often post on social media, and this will be a good way to present these little nuggets, mixed with other light-hearted content.


## Usage

- mindbob should be a website, hosted using github pages. It should be able to be added to the phone as a widget, from the website, without downloading any additional apps as far as possible. It should also be able to just be viewed from the web.
- The messages can be updated using cron jobs, that can dynamically find or generate messages, possible using github marketplace LLM apis. Open to other suggestions for optimal, fast, efficient ways of gathering the messages for display.


## Message Display Specs

### Message Content
1. The message content should vary from lighthearted jokes to insightful quotes or calls to action. 
2. The messages should not be too long, and the vibe should be casual and not too cringe or cheesy.
3. Suggest some good sources of the messages, or suggest if using the LLM API is sufficient for message generation.
4. The theme of the messages should be random for now.
5. Since the messages are generated twice a day, the one at the start of the day should be more lighthearted and encouraging, while the one at the end of the day should be more reflective, while being casual at the same time.

### Message Display
1. The message font should be the Eggi font in this repo.
2. There should be little doodles accompanying the message. I want to avoid image generation as far as possible. 
3. I can provide a rotation of little doodles to be displayed together with the message, or the user can draw a doodle and decorate the message if they want.
    - This means that the platform will have 2 modes - auto-decorated and custom-decorated.
    - The auto-decorated will involve arranging the provided doodle with the text in a simple and nice manner.
        - Suggest good ways for the cron job to get the doodle, and how this doodle database can be updated from time to time.
    - The custom-decorated will include the message in the center of the canvas, and the user can shift the message around, and include little doodles that they add themselves.
        - There should be 3 main modes/tools:
            1. Shift the message
            2. Pencil with different colours, the palette should be cohesive and different for each message.
            3. Eraser for the doodles (cannot erase the message).
    

### Overall Display
1. Overall, the website / widget should have a minimalistic theme that is aesthetically pleasing and calming at the same time.
2. The design and display has to be optimized so that it does not require heavy loading to display on the web and widget.
