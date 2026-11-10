-- Rename Agenda app card to Dev Agenda.
UPDATE applications
SET name = 'Dev Agenda',
    version = '0.1.1'
WHERE id = 'agenda';
