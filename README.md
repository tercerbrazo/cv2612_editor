CV2612 is an eurorack module based on the classic FM chip used by Sega Genesis: the great YM2612.
It has MIDI i/o, and yes! it has **control voltage inputs**!
It is on its final development stage and we hope to see it on the market soon.

#### Received CC Messages

CC messages received are on channels 1 to 16
Every CV2612 voice related parameter is mapped to a CC message by default according to the following table, but can be configured through the [CV2612 Online Tool](https://cv2612.netlify.com/)

MIDI DIN runs at 31250 bits per second. That's roughly 3000 bytes per second, which in a MIDI stream transferring CC data (3 bytes each) as quickly as possible, works out to about 1000 CC changes per second.

play-mode
vel-sensitivity
cc-mode
rgb-intensity

As a general rule, a parameter on MIDI channel 1 apllies to all six voices, and on Midi channel 2 to 7, applies to voices 1 to six respectively.
Global parameters do not take into account the MIDI channel used.

| NRPN MSB | NRPN LSB | CC  | Channel | Code | Parameter                          |
| -------- | -------- | --- | ------- | ---- | ---------------------------------- |
|          |          |     |         |      | _Global Parameters_                |
| 01       | 0        | 1   | -       | LF0  | Low Frequency Oscillator Frequency |
|          |          |     |         |      | _Channel Parameters_               |
| 20       | 0        | 20  | 1-7     | AL   | Operators Algorithm                |
| 21       | 0        | 21  | 1-7     | FB   | Feedback of Operator 1             |
| 22       | 0        | 22  | 1-7     | FMS  | Frequency Modulation Sensitivity   |
| 23       | 0        | 23  | 1-7     | AMS  | Amplitude Modulation Sensitivity   |
| 24       | 0        | 24  | 1-7     | ST   | Stereo Configuration               |
|          |          |     |         |      | _Operator 1 Parameters_            |
| 30       | 0        | 30  | 1-7     | AR   | Attack Rate                        |
| 31       | 0        | 31  | 1-7     | D1   | Decay 1 Rate                       |
| 32       | 0        | 32  | 1-7     | SL   | Sustain Level                      |
| 33       | 0        | 33  | 1-7     | D2   | Decay 2 Rate                       |
| 34       | 0        | 34  | 1-7     | RR   | Release Rate                       |
| 35       | 0        | 35  | 1-7     | TL   | Total Level                        |
| 36       | 0        | 36  | 1-7     | MUL  | Frequency Multiplier               |
| 37       | 0        | 37  | 1-7     | DET  | Detune                             |
| 38       | 0        | 38  | 1-7     | RS   | Rate Scaling                       |
| 39       | 0        | 39  | 1-7     | AM   | Amplitude Modulation Enable        |
|          |          |     |         |      | _Operator 2 ..._                   |
| 40       | 1        | 40  | 1-7     | AR   | Attack Rate                        |
|          | ...      |     |         |      | _Operator 3 ..._                   |
| 50       | 2        | 50  | 1-7     | AR   | Attack Rate                        |
|          | ...      |     |         |      | _Operator 4 ..._                   |
| 60       | 3        | 60  | 1-7     | AR   | Attack Rate                        |
|          | ...      |     |         |      |                                    |
|          |          |     |         |      | _ Commands _                       |
| 70       | 0        | -   | -       | -    | Set a patch                        |
| 71       | 1        | -   | -       | -    | Select a patch                     |
