export type CoupleRelationshipType = "Partner" | "Common-Law Partner" | "Have shared kids" | "Divorcee";

export type ParentsChildrens = {
    parentA: string;
    parentB: string;
    children: string[];
};

export type RelationTypes =
    | "Sibling"
    | "Sibling (maybe step)"
    | "Nephew/niece"
    | "Nephew/niece (maybe step)"
    | "Child"
    | "Child (maybe step)"
    | "Cousin"
    | "Cousin (maybe step)"
    | "Partner"
    | "Step child"
    | "Step sibling"
    | "Adopted child"
    | "Have shared kids"
    | "Sibling in law"
    | "Divorcee"
    | "Uncle/aunt"
    | "Uncle/aunt (maybe step)"
    | "Parent"
    | "Parent (maybe step)"
    | "Step parent"
    | "Adoptive parent"
    | "Parent in law"
    | "Child in law"
    | "Common-Law Partner"
    | "Grandchild"
    | "Grandchild in law"
    | "Grandchild (maybe step)"
    | "Grandparent"
    | "Grandparent in law"
    | "Grandparent (maybe step)"
    | "Relative"
    | "Great Grandchild"
    | "Great Grandchild in law"
    | "Great Grandchild (maybe step)"
    | "Great Grandparent"
    | "Great Grandparent in law"
    | "Great Grandparent (maybe step)"
    | "Great Nephew/niece"
    | "Great Nephew/niece (maybe step)"
    | "Great Child"
    | "Great Child (maybe step)"
    | "Great Cousin"
    | "Great Cousin (maybe step)"
    | "Great Great Grandchild"
    | "Great Great Grandchild in law"
    | "Great Great Grandchild (maybe step)"
    | "Great Great Grandparent"
    | "Great Great Grandparent in law"
    | "Great Great Grandparent (maybe step)"
    | "Great Great Nephew/niece"
    | "Great Great Nephew/niece (maybe step)"
    | "Great Great Child"
    | "Great Great Child (maybe step)"
    | "Great Great Cousin"
    | "Great Great Cousin (maybe step)"
    | "3x Great Grandchild"
    | "3x Great Grandchild in law"
    | "3x Great Grandchild (maybe step)"
    | "3x Great Grandparent"
    | "3x Great Grandparent in law"
    | "3x Great Grandparent (maybe step)"
    | "3x Great Nephew/niece"
    | "3x Great Nephew/niece (maybe step)"
    | "3x Great Child"
    | "3x Great Child (maybe step)"
    | "3x Great Cousin"
    | "3x Great Cousin (maybe step)"
    | "4x Great Grandchild"
    | "4x Great Grandchild in law"
    | "4x Great Grandchild (maybe step)"
    | "4x Great Grandparent"
    | "4x Great Grandparent in law"
    | "4x Great Grandparent (maybe step)"
    | "4x Great Nephew/niece"
    | "4x Great Nephew/niece (maybe step)"
    | "4x Great Child"
    | "4x Great Child (maybe step)"
    | "4x Great Cousin"
    | "4x Great Cousin (maybe step)"
    ;

export type FamilyRelation = {
    id: string;
    from: string;
    to: string;
    relationType: RelationTypes;
    prettyType: string;
    isInnerFamily: boolean;
};

export type BadgeData = {
    bgColor: string;
    label: string;
    textColor: string;
};

export type FamilyMember = {
    id: string;
    data: {
        badges: {
            bgColor: string;
            label: string;
            textColor: string;
        }[];
        title: string;
        titleBgColor: string;
        titleTextColor: string;
        sex: "M" | "F";
        subtitles: string[];
        isHidden: boolean;
        imageUrl?: string;
        onVisibilityChange: (isVisible: boolean) => void;
    };
};

export type FamilyMembers = Record<string, FamilyMember>;
export type FamilyRelations = Record<string, FamilyRelation>;

export type InnerFamily = {
    parents: string[];
    children: InnerFamily[];
    generation: Generation;
    width?: number;
    centerX?: number;
    couplePainted?: boolean;
};

export const OTHERS_GENERATION = 99;
export type Generation = number;
