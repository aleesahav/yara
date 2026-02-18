# sms:on
# sms:contact romlyn Quinn Romlyn
# sms:icon releases/ep00/assets/ui/romlyn_icon.png
# sms:sub Special Ops

# sms:in Captain, location?
...

# sms:typing on
...
# sms:typing off
# sms:in Du Verre. Where are you.
...

+ [I'm busy.]
    # sms:out I'm minding the mission, Romlyn.
    ...
    # sms:typing on
    ...
    # sms:typing off
    # sms:in In Fort Point?
    ...
    # sms:typing on
    ...
    # sms:typing off
    # sms:in The anomaly's location seems to be centered at the Palace of Fine Arts!
    ...
    -> after_sms

+ [(Ignore Vice Captain's text).]
    # sms:typing on
    ...
    # sms:typing off
    # sms:in DU VERRE
    ...
    -> after_sms

= after_sms
# sms:off

I turn off my phone after Vice Captain's last text.
Yara: I don't need him bothering me right now.

-> END
