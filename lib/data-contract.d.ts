/**
 * `capital:data-contract` system-prompt section: the single statement of how every Capital
 * role obtains data. Skills declare what evidence they need; this section says where it comes
 * from, so provider names and fetch recipes never live in skill prose.
 * Static text — registered per role by the selected-skills row, which every skill-loading role mounts.
 */
export declare const DATA_CONTRACT_SECTION = "capital:data-contract";
/** Just before the selected-skill brief (order 60). */
export declare const DATA_CONTRACT_ORDER = 59;
export declare function dataContractSection(): {
    name: string;
    order: number;
    interpolate: false;
    text: string;
};
