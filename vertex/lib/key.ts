import { VNID } from "./types/vnid";
export { VNID };

/** A SlugId is just a string; this typing is just more explicit than "string". */
export type SlugId = string|(string&{_slugId: never});

export type VNodeKey = SlugId|VNID;
