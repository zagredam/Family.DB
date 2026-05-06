import { useState } from 'react';
import './EditMemberModal.css';

type CoupleOption = {
    CoupleId: number;
    PartnerName: string;
    OtherPartnerName: string;
};

type AddMemberModalProps = {
    couples?: CoupleOption[];
    onSave: (data: { firstName: string; lastName: string; birthDate: string; gender: string; originCoupleId: number | null }) => void;
    onClose: () => void;
};

export function AddMemberModal({ couples, onSave, onClose }: AddMemberModalProps) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [birthDate, setBirthDate] = useState('');
    const [gender, setGender] = useState('Male');
    const [originCoupleId, setOriginCoupleId] = useState<number | null>(null);

    const handleSave = () => {
        if (!firstName.trim() && !lastName.trim()) return;
        onSave({ firstName, lastName, birthDate, gender, originCoupleId });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Add Family Member</h2>
                    <button className="modal-close" onClick={onClose}>&#x2715;</button>
                </div>
                <div className="modal-body">
                    <label className="modal-label">
                        First Name
                        <input
                            type="text"
                            className="modal-input"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            autoFocus
                        />
                    </label>
                    <label className="modal-label">
                        Last Name
                        <input
                            type="text"
                            className="modal-input"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                        />
                    </label>
                    <label className="modal-label">
                        Birth Date
                        <input
                            type="date"
                            className="modal-input"
                            value={birthDate}
                            onChange={e => setBirthDate(e.target.value)}
                        />
                    </label>
                    <label className="modal-label">
                        Gender
                        <select
                            className="modal-input"
                            value={gender}
                            onChange={e => setGender(e.target.value)}
                        >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </label>
                    {couples && couples.length > 0 && (
                        <label className="modal-label">
                            Parents
                            <select
                                className="modal-input"
                                value={originCoupleId ?? ''}
                                onChange={e => setOriginCoupleId(e.target.value ? Number(e.target.value) : null)}
                            >
                                <option value="">None</option>
                                {couples.map(c => (
                                    <option key={c.CoupleId} value={c.CoupleId}>
                                        {c.PartnerName} &amp; {c.OtherPartnerName}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
                    <button className="modal-btn primary" onClick={handleSave}>Add</button>
                </div>
            </div>
        </div>
    );
}
